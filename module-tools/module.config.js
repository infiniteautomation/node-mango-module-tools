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
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const readPom = require('./readPom');
const updatePackage = require('./updatePackage');

module.exports = (configOptions = {}) => {
    const moduleRoot = configOptions.moduleRoot || path.resolve('.');

    return readPom(moduleRoot).then(pom => {
        return updatePackage(pom, moduleRoot);
    }).then(packageJson => {
        const moduleName = packageJson.com_infiniteautomation.moduleName;

        const webPackConfig = {
            entry: {
                [moduleName]: `./web-src/${moduleName}.js`
            },
            module: {
                rules: [
                    {
                        test: /\.html$/,
                        use: [{
                            loader: 'html-loader',
                            options: {
                            }
                        }]
                    },
                    {
                        test: /\.css$/,
                        use: [
                            {
                                loader: 'style-loader',
                                options: {
                                    insert: function(style) {
                                        const meta = document.querySelector('meta[name="user-styles-after-here"]');
                                        meta.parentNode.insertBefore(style, meta);
                                    }
                                }
                            },
                            {
                                loader: 'css-loader'
                            }
                        ]
                    },
                    {
                        test: /\.(png|svg|jpg|jpeg|gif)$/,
                        use: [{
                            loader: 'file-loader',
                            options: {
                                name: 'images/[name].[ext]?v=[hash]'
                            }
                        }]
                    },
                    {
                        test: /\.(woff|woff2|eot|ttf|otf)$/,
                        use: [{
                            loader: 'file-loader',
                            options: {
                                name: 'fonts/[name].[ext]?v=[hash]'
                            }
                        }]
                    },
                    {
                        test: /\.(txt|csv)$/,
                        use: [{
                            loader: 'raw-loader'
                        }]
                    }
                ]
            },
            optimization: {
                splitChunks: false
            },
            plugins: [
                new CleanWebpackPlugin({
                    cleanStaleWebpackAssets: false
                }),
                new CopyWebpackPlugin([{
                    context: 'web-src/static',
                    from: '**/*'
                }])
            ],
            output: {
                filename: '[name].js?v=[chunkhash]',
                path: path.resolve('web', 'angular'),
                publicPath: `/modules/${moduleName}/web/angular/`,
                libraryTarget: 'umd',
                libraryExport: 'default',
                library: moduleName
            },
            externals: {
                'angular': 'angular',
                'cldrjs': 'cldrjs',
                'cldr-data': 'cldr-data',
                'file-saver': 'file-saver',
                'globalize': 'globalize',
                'ipaddr.js': 'ipaddr.js',
                'jquery': 'jquery',
                'js-sha512': 'sha512',
                'jszip': 'jszip',
                'mathjs': 'mathjs',
                'moment': 'moment',
                'moment-timezone': 'moment-timezone',
                'papaparse': 'papaparse',
                'pdfmake': 'pdfmake',
                'plotly.js': 'plotly.js',
                'stacktrace-js': 'stacktrace-js',
                'tinycolor2': 'tinycolor2',
                'xlsx': 'xlsx'
            }
        };

        return webPackConfig;
    });
};
