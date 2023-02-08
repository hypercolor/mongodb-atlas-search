import {IPaginatedInput} from "../interfaces/i-paginated-input";
import {IGenericFormat} from "../interfaces/i-generic-format";

import {Db} from "mongodb";
import {IMongoCompoundSearchFormat} from "../interfaces/i-mongo-compound-search-format";
import {IMongoTextSearchFormat} from "../interfaces/i-mongo-text-search-format";
import {IPaginatedOutput} from "../interfaces/i-paginated-output";
import {AtlasSearchManager} from "../managers/atlas-search-manager";


export abstract class BaseQuery {
    protected constructor(
        protected collectionName: string,
        private pagination: IPaginatedInput,
        private mongoAtlasUser: string,
        private mongoAtlasUserKey: string,
        private mongodbUrl: string,
        private databaseName: string,
        private clusterName: string,
        private groupId: string,
        private pipeline?: Array<IGenericFormat>) {};
    protected abstract buildSearchOptions(): Promise<IMongoCompoundSearchFormat>;
    protected abstract formatDocuments(docs: Array<any>): Array<IGenericFormat>;

    protected buildSort(sort: string, order: string): IGenericFormat {
        return {[sort]: this.convertOrderToMongoFormat(order)};
    }

    protected async buildTextSearchQuery(query: string, sort: IGenericFormat, paths: Array<string>): Promise<IMongoTextSearchFormat> {
        const searchShould: Array<IGenericFormat> = [];

        const searchSort = {
            score: -1,
            ...sort
        };

        searchShould.push({
            text: {
                path: paths,
                query,
                fuzzy: {
                    maxEdits: 2, //default is two
                    prefixLength: 1, //defines how many chars in the string (from the beginning) must remain unchanged
                    maxExpansions: 100 // defines the limit of similar terms returned for the search term
                }
            }
        });

        // split up words in the case of searching with a phrase
        const terms = query.trim().split(' ');
        const searchMust: Array<IGenericFormat> = [];

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

        return {searchShould, searchSort, searchMust}
    }

    public async run(): Promise<IPaginatedOutput> {
        const connection: Db = await new AtlasSearchManager(
            this.mongoAtlasUser,
            this.mongoAtlasUserKey,
            this.mongodbUrl,
            this.databaseName,
            this.clusterName,
            this.groupId
        ).connect();
        await this.buildSearchPipeline();
        try {
            const results: Array<any> = await connection.collection(this.collectionName)
                .aggregate(this.pipeline)
                .toArray();

            return this.formatResults(results);
        }
        catch(err: any) {
            console.log("Mongo Query error: ", err.toLocaleString());
            throw {code: 500, error: 'Mongodb Query Error: ' + err.toLocaleString()};
        }
    }


    private async buildSearchPipeline(): Promise<void> {
        const {must, mustNot, should, filter, sort} = await this.buildSearchOptions();
        const pipeline: Array<IGenericFormat> = [
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
            {$sort: sort},
            {
                $project: {
                    _id: 0,
                    _source: 0,
                    score: {$meta: 'searchScore'}
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
                        {$replaceWith: '$$SEARCH_META'},
                        {$limit: 1}
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

            compound.should.forEach((filter: any) => {
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
            }
        }

        if (this.pagination.verbose) {
            console.log(this.collectionName + ' directory params: ' + JSON.stringify(this.pagination));
            console.log(this.collectionName + ' Atlas Search query: ', JSON.stringify(pipeline));
        }
        this.pipeline = pipeline;
    }

    private formatResults(results: Array<any>): IPaginatedOutput {
        //expecting only one item in the array;
        if (results.length !==1) {
            throw {code: 500, error: 'Unexpected Atlas Search return format'}
        }

        const result: {docs: Array<IGenericFormat>, meta: Array<{count: {total: number}}>} = results[0];

        if (this.pagination.verbose) {
            console.log("Mongo search results: ", JSON.stringify(result, null, 2));
        }

        const total = result.meta.length > 0 && result.meta[0].count && result.meta[0].count.total ?  result.meta[0].count.total : 0;
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
        }
    }

    private convertOrderToMongoFormat(order?: string): 1 | -1 {
        if (order && order.trim() ==='asc') {
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