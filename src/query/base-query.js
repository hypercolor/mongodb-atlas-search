"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseQuery = void 0;
const atlas_search_manager_1 = require("../managers/atlas-search-manager");
class BaseQuery {
    constructor(collectionName, pagination, mongoAtlasUser, mongoAtlasUserKey, mongodbUrl, databaseName, clusterName, groupId, pipeline) {
        this.collectionName = collectionName;
        this.pagination = pagination;
        this.mongoAtlasUser = mongoAtlasUser;
        this.mongoAtlasUserKey = mongoAtlasUserKey;
        this.mongodbUrl = mongodbUrl;
        this.databaseName = databaseName;
        this.clusterName = clusterName;
        this.groupId = groupId;
        this.pipeline = pipeline;
    }
    ;
    buildSort(sort, order) {
        return { [sort]: this.convertOrderToMongoFormat(order) };
    }
    async buildTextSearchQuery(query, sort, paths) {
        const searchShould = [];
        const searchSort = {
            score: -1,
            ...sort
        };
        searchShould.push({
            text: {
                path: paths,
                query,
                fuzzy: {
                    maxEdits: 2,
                    prefixLength: 1,
                    maxExpansions: 100 // defines the limit of similar terms returned for the search term
                }
            }
        });
        // split up words in the case of searching with a phrase
        const terms = query.trim().split(' ');
        const searchMust = [];
        // In addition to the above fuzzy query, we want to run a wildcard query with a boost of the split search string to support severe case partial matches.
        if (terms.length > 0) {
            terms.forEach(it => {
                const word = '*' + it.trim() + '*';
                searchMust.push({
                    wildcard: {
                        path: paths,
                        query: word,
                        allowAnalyzedField: true,
                        score: {
                            boost: { value: 10 }
                        }
                    }
                });
            });
        }
        return { searchShould, searchSort, searchMust };
    }
    async run() {
        const connection = await new atlas_search_manager_1.AtlasSearchManager(this.mongoAtlasUser, this.mongoAtlasUserKey, this.mongodbUrl, this.databaseName, this.clusterName, this.groupId).connect();
        await this.buildSearchPipeline();
        try {
            const results = await connection.collection(this.collectionName)
                .aggregate(this.pipeline)
                .toArray();
            return this.formatResults(results);
        }
        catch (err) {
            console.log("Mongo Query error: ", err.toLocaleString());
            throw { code: 500, error: 'Mongodb Query Error: ' + err.toLocaleString() };
        }
    }
    async buildSearchPipeline() {
        const { must, mustNot, should, filter, sort } = await this.buildSearchOptions();
        const pipeline = [
            {
                $search: {
                    index: this.collectionName,
                    compound: {
                        must,
                        mustNot,
                        should,
                        filter
                    },
                    count: {
                        type: 'total'
                    },
                    returnStoredSource: this.pagination.includeSource
                }
            },
            { $sort: sort },
            {
                $project: {
                    _id: 0,
                    _source: 0,
                    score: { $meta: 'searchScore' }
                }
            },
            {
                $facet: {
                    docs: [{
                            $skip: this.pagination.pageNum * this.pagination.pageSize
                        }, {
                            $limit: this.pagination.pageSize
                        }],
                    meta: [
                        { $replaceWith: '$$SEARCH_META' },
                        { $limit: 1 }
                    ]
                }
            }
        ];
        const compound = pipeline[0].$search.compound;
        if (compound.should && compound.should.length > 0) {
            //if a should clause exists, ensure at least one of the should clauses is enforced for each result.
            compound.minimumShouldMatch = 1;
            let hasTextSearch = false;
            let hasOtherShouldFilter = false;
            compound.should.forEach((filter) => {
                filter.text ? hasTextSearch = true : hasOtherShouldFilter = true;
            });
            // if there is no text filter, but other searchFilters are present, we set minimumShouldMatch to 1 to define that a single OR case must match a returning item.
            if (hasOtherShouldFilter && !hasTextSearch) {
                compound.minimumShouldMatch = 1;
            }
            // If there is a text filter and no other should filters, we want to remove the minimumShouldMatch to allow for more broad search results.
            if (!hasOtherShouldFilter && hasTextSearch) {
                compound.minimumShouldMatch = 0;
            }
        }
        //if no must / mustNot / should / filter params are set, the compound operator needs to be removed, and replaced with a wildcard or text search.
        if (compound.must.length === 0 && compound.mustNot.length === 0 && compound.should.length === 0 && compound.filter.length === 0) {
            if (this.pagination.verbose) {
                console.log("No compound filters detected, deleting step...");
            }
            delete pipeline[0].$search.compound;
            pipeline[0].$search.wildcard = {
                query: '*',
                path: {
                    wildcard: '*'
                },
                allowAnalyzedField: true
            };
        }
        if (this.pagination.verbose) {
            console.log(this.collectionName + ' directory params: ' + JSON.stringify(this.pagination));
            console.log(this.collectionName + ' Atlas Search query: ', JSON.stringify(pipeline));
        }
        this.pipeline = pipeline;
    }
    formatResults(results) {
        //expecting only one item in the array;
        if (results.length !== 1) {
            throw { code: 500, error: 'Unexpected Atlas Search return format' };
        }
        const result = results[0];
        if (this.pagination.verbose) {
            console.log("Mongo search results: ", JSON.stringify(result, null, 2));
        }
        const total = result.meta.length > 0 && result.meta[0].count && result.meta[0].count.total ? result.meta[0].count.total : 0;
        const items = this.formatDocuments(result.docs);
        return {
            meta: {
                count: items.length,
                page: this.pagination.pageNum,
                pageSize: this.pagination.pageSize,
                verbose: this.pagination.verbose || false,
                total
            },
            items
        };
    }
    convertOrderToMongoFormat(order) {
        if (order && order.trim() === 'asc') {
            return 1;
        }
        if (order && order.trim() === 'desc') {
            return -1;
        }
        else {
            console.log('MongoSearchQuery: Unexpected order type: ' + order + '. Reassigning order to desc');
            return -1;
        }
    }
}
exports.BaseQuery = BaseQuery;
//# sourceMappingURL=base-query.js.map