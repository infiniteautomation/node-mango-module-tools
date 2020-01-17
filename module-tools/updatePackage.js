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

const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const defaultPackageJson = require('./defaultPackage.json');

module.exports = function updatePackage(pom, directory = path.resolve('.'), writeFile = false) {
    const packageJsonPath = path.join(directory, 'package.json');

    return new Promise((resolve, reject) => {
        fs.readFile(packageJsonPath, 'utf8', (error, data) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    resolve(defaultPackageJson);
                } else {
                    reject(error);
                }
            } else {
                resolve(data);
            }
        });
    }).then(packageJsonString => {
        const packageJson = typeof packageJsonString === 'string' ? JSON.parse(packageJsonString) : packageJsonString;
        const originalPackageJson = _.cloneDeep(packageJson);

        if (packageJson.com_infiniteautomation == null) {
            packageJson.com_infiniteautomation = {};
        }

        packageJson.com_infiniteautomation.moduleName = pom.project.name[0];
        packageJson.name = '@infinite-automation/' + pom.project.name[0];
        packageJson.version = pom.project.version[0];
        packageJson.description = pom.project.description[0];
        packageJson.main = `web/angular/${pom.project.name[0]}.js`;

        if (!writeFile || _.isEqual(packageJson, originalPackageJson)) {
            return Promise.resolve(packageJson);
        }

        return new Promise((resolve, reject) => {
            const newContents = JSON.stringify(packageJson, null, 2);
            fs.writeFile(packageJsonPath, newContents, error => {
                if (error) {
                    reject(error);
                } else {
                    resolve(packageJson);
                }
            });
        });
    });
};
