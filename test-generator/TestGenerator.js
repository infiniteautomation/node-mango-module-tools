/**
 * Copyright 2020 Infinite Automation Systems Inc.
 * http://infiniteautomation.com/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const path = require('path');
const {dashCase, camelCase} = require('./util');
const Handlebars = require('handlebars');

class TestGenerator {
    constructor(options) {
        Object.assign(this, options);

        this.handlebars = Handlebars.create();

        this.handlebars.registerHelper('eq', (a, b) => a === b);
        this.handlebars.registerHelper('dash_case', dashCase);
        this.handlebars.registerHelper('camel_case', camelCase);
        this.handlebars.registerHelper('has_param_type', (parameters, type) => parameters && parameters.some(p => p.in === type));
        this.handlebars.registerHelper('json', (input, spaces) => JSON.stringify(input, null, spaces));
        this.handlebars.registerHelper('find_body_schema', (parameters) => parameters.find(p => p.in === 'body').schema);
        this.handlebars.registerHelper('find_success_response', (responses) => {
            return [200, 201].map(statusCode => {
                const response = responses[statusCode];
                return response && Object.assign({statusCode}, response);
            }).find(r => !!r);
        });

        this.handlebars.registerHelper('print_schema', (schema, options) => {
            return this.printSchema(schema, options.loc.start.column);
        });

        this.handlebars.registerHelper('print_assertions', (schema, dataPath, options) => {
            return this.printAssertions(schema, dataPath, options.loc.start.column);
        });

        this.handlebars.registerHelper('get_schema', (ref, options) => {
            return this.getSchema(ref);
        });

        const fileTemplate = fs.readFileSync(this.fileTemplate, 'utf-8');
        const testTemplate = fs.readFileSync(this.testTemplate, 'utf-8');

        this.handlebars.registerPartial('test', testTemplate);
        this.compiledTemplate = this.handlebars.compile(fileTemplate, {noEscape: true});

        this.fileNameTemplate = this.handlebars.compile(this.fileName, {noEscape: true, strict: true});
    }

    getSchema(ref) {
        const matches = /^#\/definitions\/(.*)$/.exec(ref);
        const defName = matches && matches[1];
        return this.apiDocs.definitions[defName];
    }

    printSchema(schema, spaces = 0) {
        const linePrefix = ''.padStart(spaces);
        if (schema.$ref) {
            return this.printSchema(this.getSchema(schema.$ref), spaces);
        } else if (schema.type === 'object') {
            const lines = [];
            lines.push(`{ // ${schema.title}`);
            if (schema.properties) {
                Object.entries(schema.properties).forEach(([key, value], index, array) => {
                    const last = index === array.length - 1;
                    const comma = last ? '' : ',';
                    lines.push(`    ${key}: ${this.printSchema(value, spaces + 4)}${comma}`);
                });
            }
            lines.push('}');
            return lines.join(`\n${linePrefix}`);
        } else if (schema.type === 'array') {
            const lines = [];
            lines.push('[');
            lines.push('    ' + this.printSchema(schema.items, spaces + 4));
            lines.push(']');
            return lines.join(`\n${linePrefix}`);
        } else if (schema.type === 'boolean') {
            return 'false';
        } else if (schema.type === 'integer') {
            return '0';
        } else if (schema.type === 'number') {
            return '0.0';
        } else if (schema.type === 'string') {
            return '\'string\'';
        } else {
            return `// UNKNOWN SCHEMA TYPE ${schema.type}`;
        }
    }

    printAssertions(schema, dataPath = '', spaces = 0) {
        const linePrefix = ''.padStart(spaces);
        if (schema.$ref) {
            return this.printAssertions(this.getSchema(schema.$ref), dataPath, spaces);
        } else if (schema.type === 'object') {
            const lines = [];
            if (schema.title) {
                lines.push(`// ${schema.title}`);
            }
            lines.push(`assert.isObject(${dataPath});`);
            if (schema.properties) {
                Object.entries(schema.properties).forEach(([key, value]) => {
                    lines.push(this.printAssertions(value, `${dataPath}.${key}`, spaces));
                });
            }
            if (schema.title) {
                lines.push(`// END ${schema.title}`);
            }
            return lines.join(`\n${linePrefix}`);
        } else if (schema.type === 'array') {
            const lines = [];
            lines.push(`assert.isArray(${dataPath});`);
            lines.push(`assert.isAbove(${dataPath}.length, 0);`);
            if (schema.items) {
                lines.push(this.printAssertions(schema.items, `${dataPath}[0]`, spaces));
            }
            return lines.join(`\n${linePrefix}`);
        } else if (schema.type === 'boolean') {
            return `assert.isBoolean(${dataPath});`;
        } else if (schema.type === 'integer' || schema.type === 'number') {
            return `assert.isNumber(${dataPath});`;
        } else if (schema.type === 'string') {
            return `assert.isString(${dataPath});`;
        } else {
            return `// UNKNOWN SCHEMA TYPE ${schema.type}`;
        }
    }

    generateTests(tagNames, methods, pathMatch) {
        if (!tagNames) tagNames = this.apiDocs.tags.map(t => t.name);
        return Promise.all(tagNames.map(t => this.generateTestsSingle(t, methods, pathMatch)));
    }

    generateTestsSingle(tagName, methodsArray, pathMatch) {
        const tag = this.apiDocs.tags.find(t => t.name === tagName);
        if (!tag) throw new Error(`Tag name '${tagName}' not found in Swagger API documentation`);

        const paths = [];
        Object.entries(this.apiDocs.paths).forEach(([path, methods]) => {
            if (!pathMatch || pathMatch.test(this.apiDocs.basePath + path)) {
                Object.entries(methods).forEach(([method, description]) => {
                    if (!methodsArray || methodsArray.some(m => m.toLowerCase() === method)) {
                        if (description.tags.includes(tagName)) {
                            paths.push(Object.assign({path, method: method.toUpperCase()}, description));
                        }
                    }
                });
            }
        });

        const fileResult = this.compiledTemplate({
            apiDocs: this.apiDocs,
            tag,
            paths
        });

        const fileName = this.fileNameTemplate({
            apiDocs: this.apiDocs,
            tag,
            basePath: dashCase(this.apiDocs.basePath, '/').slice(1)
        });

        const filePath = path.resolve(this.directory, fileName);
        fs.writeFileSync(filePath, fileResult, {flag: this.overwrite ? 'w' : 'wx'});
    }
}

module.exports = TestGenerator;
