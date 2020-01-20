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
const {dashCase} = require('./util');
const Handlebars = require('handlebars');

class TestGenerator {
    constructor(options) {
        Object.assign(this, options);

        this.handlebars = Handlebars.create();

        this.handlebars.registerHelper('check_depth', (depth, options) => {
            let count = 0;
            for (let data = options.data; data != null; data = data._parent) {
                count++;
            }
            return count >= depth;
        });

        this.handlebars.registerHelper('eq', (a, b) => a === b);
        this.handlebars.registerHelper('join', (...args) => args.slice(0, -1).join(''));
        this.handlebars.registerHelper('includes', (array, key) => Array.isArray(array) && array.includes(key));
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

        this.handlebars.registerHelper('get_schema', (ref, options) => {
            return this.getSchema(ref);
        });

        const paramValue = function(param) {
            if (param.hasOwnProperty('default')) {
                return typeof param.default === 'string' ? `'${param.default}'` : param.default;
            }
            if (Array.isArray(param.enum) && param.enum.length) {
                return `'${param.enum[0]}'`;
            }
            switch(param.type) {
            case 'string': return `'string'`;
            case 'integer': return '0';
            case 'number': return '0.0';
            case 'boolean': return 'true';
            case 'array': return param.items ? `[${paramValue(param.items)}]` : '[]';
            default: return 'undefined';
            }
        };

        this.handlebars.registerHelper('param_value', paramValue);

        const fileTemplate = fs.readFileSync(this.fileTemplate, 'utf-8');
        const testTemplate = fs.readFileSync(this.testTemplate, 'utf-8');
        const assertTemplate = fs.readFileSync(this.assertTemplate, 'utf-8');

        this.handlebars.registerPartial('test', testTemplate);
        this.handlebars.registerPartial('assert', assertTemplate);
        this.compiledTemplate = this.handlebars.compile(fileTemplate, {noEscape: true});

        this.fileNameTemplate = this.handlebars.compile(this.fileName, {noEscape: true, strict: true});
    }

    getSchema(ref) {
        const matches = /^#\/definitions\/(.*)$/.exec(ref);
        const defName = matches && matches[1];
        return this.apiDocs.definitions[defName];
    }

    printSchema(schema, spaces = 0, depth = 0) {
        if (depth >= 20) {
            return `// RECURSION DEPTH EXCEEDED ${depth}`;
        }

        if (schema.$ref) {
            const referencedSchema = this.getSchema(schema.$ref);
            if (!referencedSchema) {
                return `// UNKNOWN SCHEMA REF ${schema.$ref}`;
            }
            return this.printSchema(referencedSchema, spaces, depth + 1);
        }

        const linePrefix = ''.padStart(spaces);
        const lines = [];

        if (schema.type === 'object') {
            lines.push(`{ // title: ${schema.title}`);
            if (schema.properties) {
                const required = new Set(schema.required || []);

                Object.entries(schema.properties)
                .filter(([key, value]) => !this.requiredPropertiesOnly || required.has(key))
                .forEach(([key, value], index, array) => {
                    const last = index === array.length - 1;
                    const comma = last ? '' : ',';
                    lines.push(`    ${key}: ${this.printSchema(value, spaces + 4, depth + 1)}${comma}`);
                });
            }
            lines.push('}');
        } else if (schema.type === 'array') {
            lines.push('[');
            lines.push('    ' + this.printSchema(schema.items, spaces + 4, depth + 1));
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
