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
const xml2js = require('xml2js');
const fs = require('fs');

module.exports = function readPom(directory = path.resolve('.')) {
    return new Promise((resolve, reject) => {
        const parser = new xml2js.Parser();
        fs.readFile(path.join(directory, 'pom.xml'), function(err, data) {
            if (err) {
                reject(err);
            } else {
                parser.parseString(data, function (err, result) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            }
        });
    });
}
