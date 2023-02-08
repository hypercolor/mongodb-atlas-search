"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Example = void 0;
const base_query_1 = require("../../src/query/base-query");
class Example extends base_query_1.BaseQuery {
    constructor(collectionName, options) {
        super(collectionName, options, '', //replace with process.env var
        '', //replace with process.env var
        '', //replace with process.env var
        '', //replace with process.env var
        '', //replace with process.env var
        '');
        this.collectionName = collectionName;
        this.options = options;
    }
    async buildSearchOptions() {
        //Always initialize and return these arrays. The filters will be places into these to build the query:
        const must = [];
        const mustNot = [];
        const should = [];
        const filter = [];
        let sort = this.buildSort(this.options.sort || 'name', this.options.order || 'desc');
        /*
    
        Syntax example for using text search. There is a protected method in the base class that has a well tested fuzzy search that is useful in mose search cases.
    
         */
        if (this.options.sort) {
            const paths = []; // List the columns you want to include in the text search here
            const { searchShould, searchMust, searchSort } = await this.buildTextSearchQuery(this.options.search, sort, paths);
            // update existing must and sort arrays with pre-build text-search queries
            must.push(...searchMust);
            should.push(...searchShould);
            sort = searchSort; //update search with new search score param
        }
        /*
        syntax example for matching a single Number data type (e.g. matching an ID), I know it's ugly. don't @ me
    
        if building a global level search, use the following syntax:
        */
        if (this.options.id) {
            filter.push({
                range: {
                    path: 'id',
                    gte: this.options.id,
                    lte: this.options.id
                }
            });
        }
        /*
         Insert query definitions here based on input options...
    
         - treat must as an AND query.
            - e.g. returned documents must match all params.
            - scoring applied.
            - docs returned that meet this filter plus any subsequent filters in mustNot, should, filter have a higher score, use caution when ordering by score (e.g. using this.options.search)
    
         - treat mustNot as an AND NOT query.
            - e.g. returned documents must match all params.
            - scoring applied.
    
         - treat should as an OR query.
            - e.g. returned documents must match at least 1 param.
            - scoring applied.
            - most common used for searching text
              - e.g this.options.search
    
         - treat filter as a basic WHERE query.
            - e.g. returned documents must match all params.
            - does not affect scoring.
    
          More detailed info can be found at: https://www.mongodb.com/docs/atlas/atlas-search/compound/
         */
        return { must, mustNot, should, filter, sort };
    }
    formatDocuments(docs) {
        //example, see incoming results from mongo to map proper PK ID as the objectId
        return docs.map((doc) => ({
            objectId: doc.primaryKeyId,
            score: doc.score,
            source: this.options.includeSource ? doc : undefined
        }));
    }
}
exports.Example = Example;
//# sourceMappingURL=example.js.map