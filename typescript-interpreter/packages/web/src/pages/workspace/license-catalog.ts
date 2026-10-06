// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

export interface LicenseOption {
  id: string;
  note: string;
}

export const LICENSES: LicenseOption[] = [
  { id: "MIT", note: "Simple and permissive" },
  { id: "Apache-2.0", note: "Permissive, with a patent grant" },
  { id: "BSD-3-Clause", note: "Permissive, no endorsement" },
  { id: "BSD-2-Clause", note: "Permissive and minimal" },
  { id: "ISC", note: "Like MIT, even shorter" },
  { id: "MPL-2.0", note: "Changes to its own files stay open" },
  { id: "LGPL-3.0-or-later", note: "Weak copyleft, made for libraries" },
  { id: "GPL-3.0-or-later", note: "Anything built on it stays open" },
  { id: "AGPL-3.0-or-later", note: "Stays open even over a network" },
  { id: "CC-BY-4.0", note: "Free to reuse, with credit" },
  { id: "CC0-1.0", note: "Public domain dedication" },
  { id: "Unlicense", note: "Public domain, no conditions" },
  { id: "Proprietary", note: "All rights reserved" },
];
