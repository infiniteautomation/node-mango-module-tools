#!/usr/bin/env node

/**
 * Copyright 2020 Infinite Automation Systems Inc.
 * http://infiniteautomation.com/
 */

const TestGenerator = require('./TestGenerator');
const fileTemplatePath = require.resolve('./templates/mocha-spec.js.hbs');
const testTemplatePath = require.resolve('./templates/mocha-test.js.hbs');
const {parseArguments} = require('./util');
const {createClient, login} = require('../test-helper/testHelper');
const client = createClient();

const options = parseArguments(process.argv.slice(2), {
    help: {type: 'boolean', defaultValue: false, description: 'Generates Mocha tests cases from Swagger/OpenAPI docs'},
    basePath: {required: true, description: 'Base path to Swagger definitions, e.g. /rest/v1'},
    listTags: {type: 'boolean', defaultValue: false, description: 'Lists tag names and descriptions'},
    tagNames: {type: 'array', description: 'Tag names to generate test files for'},
    methods: {type: 'array', description: 'HTTP methods to include in test files'},
    matchPath: {type: 'regex', regexFlags: 'i', description: 'Only paths which match will be included in test files'},
    requiredPropertiesOnly: {type: 'boolean', defaultValue: false, description: 'Only include required properties in generated models'},
    fileTemplate: {defaultValue: fileTemplatePath, description: 'Path to Handlebars template file for test file'},
    testTemplate: {defaultValue: testTemplatePath, description: 'Path to Handlebars template file for test case'},
    fileName: {defaultValue: '{{basePath}}-{{tag.name}}.spec.js', description: 'Filename template to save test files as'},
    directory: {defaultValue: '.', description: 'Directory to save test files in'},
    overwrite: {type: 'boolean', defaultValue: false, description: 'Set to true to overwrite test files'}
});

login(client).then(user => {
    return client.restRequest({
        path: `${options.basePath}/swagger/v2/api-docs`
    });
}).then(response => {
    const apiDocs = response.data;

    if (options.listTags) {
        console.table(apiDocs.tags);
        return;
    }

    const generator = new TestGenerator({
        apiDocs,
        overwrite: options.overwrite,
        fileTemplate: options.fileTemplate,
        testTemplate: options.testTemplate,
        fileName: options.fileName,
        directory: options.directory,
        requiredPropertiesOnly: options.requiredPropertiesOnly
    });

    return generator.generateTests(options.tagNames, options.methods, options.matchPath);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
