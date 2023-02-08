import {Example} from "../query/example";

export class ExampleController {
    public async handleRequest() {
        const params = {}; //mapped input params
        const results = await new Example('', params).run();
        return results;
    }
}