"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExampleController = void 0;
const example_1 = require("../query/example");
class ExampleController {
    async handleRequest() {
        const params = {}; //mapped input params
        const results = await new example_1.Example('', params).run();
        return results;
    }
}
exports.ExampleController = ExampleController;
//# sourceMappingURL=example.js.map