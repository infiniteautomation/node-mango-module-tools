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
        if (schema.$ref) {
            return this.printSchema(this.getSchema(schema.$ref), spaces);
        }

        const linePrefix = ''.padStart(spaces);
        const lines = [];

        if (schema.type === 'object') {
            lines.push(`{ // ${schema.title}`);
            if (schema.properties) {
                const required = new Set(schema.required || []);

                Object.entries(schema.properties)
                .filter(([key, value]) => !this.requiredPropertiesOnly || required.has(key))
                .forEach(([key, value], index, array) => {
                    const last = index === array.length - 1;
                    const comma = last ? '' : ',';
                    lines.push(`    ${key}: ${this.printSchema(value, spaces + 4)}${comma}`);
                });
            }
            lines.push('}');
        } else if (schema.type === 'array') {
            lines.push('[');
            lines.push('    ' + this.printSchema(schema.items, spaces + 4));
            lines.push(']');
        } else if (schema.type === 'boolean') {
            lines.push('false');
        } else if (schema.type === 'integer') {
            lines.push('0');
        } else if (schema.type === 'number') {
            lines.push('0.0');
        } else if (schema.type === 'string') {
            lines.push(Array.isArray(schema['enum']) ? `'${schema.enum[0]}'` : `'string'`);
        } else {
            lines.push(`// UNKNOWN SCHEMA TYPE ${schema.type}`);
        }

        return lines.join(`\n${linePrefix}`);
    }

    printAssertions(schema, dataPath = '', spaces = 0) {
        if (schema.$ref) {
            return this.printAssertions(this.getSchema(schema.$ref), dataPath, spaces);
        }

        const linePrefix = ''.padStart(spaces);
        const lines = [];
        if (schema.title) {
            lines.push(`// MODEL: ${schema.title}`);
        }
        if (schema.description) {
            lines.push(`// DESCRIPTION: ${schema.description}`);
        }

//        const copy = Object.assign({}, schema);
//        delete copy.items;
//        delete copy.properties;
//        lines.push(`// Schema: ${JSON.stringify(copy)}`);

        if (schema.type === 'object') {
            const required = new Set(schema.required || []);

            lines.push(`assert.isObject(${dataPath}, '${dataPath}');`);
            if (schema.properties) {
                Object.entries(schema.properties).forEach(([key, value]) => {
                    if (!required.has(key)) {
                        lines.push(`if (${dataPath}.hasOwnProperty('${key}')) {`);
                        lines.push('    ' + this.printAssertions(value, `${dataPath}.${key}`, spaces + 4));
                        lines.push('}');
                    } else {
                        lines.push(this.printAssertions(value, `${dataPath}.${key}`, spaces));
                    }
                });
            }
        } else if (schema.type === 'array') {
            lines.push(`assert.isArray(${dataPath}, '${dataPath}');`);
            lines.push(`assert.isAbove(${dataPath}.length, 0, '${dataPath}');`);
            if (schema.items) {
                lines.push(this.printAssertions(schema.items, `${dataPath}[0]`, spaces));
            }
        } else if (schema.type === 'boolean') {
            lines.push(`assert.isBoolean(${dataPath}, '${dataPath}');`);
        } else if (schema.type === 'integer' || schema.type === 'number') {
            lines.push(`assert.isNumber(${dataPath}, '${dataPath}');`);
        } else if (schema.type === 'string') {
            lines.push(`assert.isString(${dataPath}, '${dataPath}');`);
            if (Array.isArray(schema.enum)) {
                lines.push(`assert.include(${JSON.stringify(schema.enum)}, ${dataPath}, '${dataPath}');`);
            }
        } else {
            lines.push(`// UNKNOWN SCHEMA TYPE ${schema.type}`);
        }

        if (schema.title) {
            lines.push(`// END MODEL: ${schema.title}`);
        }

        return lines.join(`\n${linePrefix}`);
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
