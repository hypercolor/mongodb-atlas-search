import AxiosDigestAuth from "@mhoc/axios-digest-auth";
import {Db, MongoClient} from "mongodb";
import {IPreparedDocumentToIndex} from "../interfaces/i-prepared-document-to-index";
import {IIndexFormat} from "../interfaces/i-index-format";
import {AxiosRequestConfig} from "axios";


export class AtlasSearchManager {
    constructor(
        private mongoAtlasUser: string,
        private mongoAtlasUserKey: string,
        private mongodbUrl: string,
        private databaseName: string,
        private clusterName: string,
        private groupId: string
        ) {
    }

    private digestAuth = new AxiosDigestAuth({
        username: this.mongoAtlasUser,
        password: this.mongoAtlasUserKey,
    });

    private database?: Db;

    public async connect() {
        if (!this.database) {
            const connection = await MongoClient.connect(this.mongodbUrl);
            this.database = connection.db(this.databaseName);
        }
        return this.database;
    }

    public async bulkIndex(documents: Array<IPreparedDocumentToIndex>) {
        if (!documents || documents.length === 0) {
            return;
        }
        try {

            const pendingToIndex: Array<IIndexFormat> = [];
            documents.map(doc => {
                const formatted = {
                    index: doc.indexName.split('__')[0], //incoming format: 'content__2022_7_22__14_57_40'
                    ...doc,
                }

                formatted.document.indexedDocumentId = doc.indexedDocumentId;
                formatted.document.indexName = doc.indexName;

                pendingToIndex.push(formatted);
            });

            const result = await this.indexDocuments(pendingToIndex);
            if (result.errors.length > 0) {
                console.info('warning, errors on bulk API action:');
                console.info('items: ' + JSON.stringify(result.errors, null, 2));
            }
            else {
                console.info( 'Mongodb Indexing Results - Documents sent: ' + result.documentCount + ' -- successfully indexed count: ' + result.successCount)
            }

        } catch (err) {
            console.error(`Error bulk indexing documents into mongodb: ${err}`);
            console.error(JSON.stringify(err));
            throw err;
        }
        // console.log('done bulk indexing');
    }

    public async deleteIndex(indexName: string, collectionName: string) {
        const indexId = await this.findIndexByIndexName(indexName, collectionName);
        if (!indexId) {
            // console.log("No indexId found, cancelling deletion...");
            return;
        }
        const url = `/groups/${this.groupId}/clusters/${this.clusterName}/fts/indexes/${indexId}`;
        await this.performRequest(url, {
            method: 'DELETE',
        });
    }


    public async createIndex(name: string, collectionName: string, indexSettingsBody?: any) {
        console.log("Creating mongo index: ", name, indexSettingsBody);
        const url = `/groups/${this.groupId}/clusters/${this.clusterName}/fts/indexes`;
        const json = JSON.stringify({
            collectionName,
            database: this.databaseName,
            name,
            ...indexSettingsBody
        });
        await this.performRequest(url, {
            method: 'POST',
            dataType: 'json',
            data: json
        });
    }

    private async findIndexByIndexName(indexName: string, collectionName: string): Promise<string | undefined> {
        const url = `/groups/${this.groupId}/clusters/${this.clusterName}/fts/indexes/${this.databaseName}/${collectionName}`;
        const result: Array<any> = await this.performRequest(url, {
            method: 'GET',
        });

        if (result.length > 0) {
            // console.log("Atlas GET indexes result: ", result)
            const indexes: Array<string> = result.filter(i => {
                // console.log("Comparing: " + i.name + ' with: ' + indexName);
                // console.log("Detected Match: ", i.name === indexName);
                return i.name === indexName;
            }).map(i => i.indexID);
            if (indexes) {
                if (indexes.length === 0) {
                    // console.log("No index name matches found");
                    return undefined;
                }
                else {
                    return indexes[0];
                }
            }
            else {
                // console.log("No index name found");
                return undefined;
            }
        }
        else {
            // console.log("No existing indexes found to determine indexId.");
            return undefined;
        }
    }

    public async deleteIndexedDocument(indexName: string, indexedDocumentId: string, ignoreNotFound?: boolean) {
        const connection = await this.connect();

        const result = await this.deleteDocument(connection, indexName, indexedDocumentId, ignoreNotFound)
        console.info(`Deleted ${indexName} document: ` + indexedDocumentId + ' with status: ' + JSON.stringify(result.status));
        return result;
    }

    private async deleteDocument(connection: Db, collection: string, indexedDocumentId: string, ignoreNotFound?: boolean) {

        try {
            await connection.collection(collection).deleteMany({indexedDocumentId});
            return {
                status: 'OK'
            }
        }
        catch (err: any) {
            if (ignoreNotFound) {
                console.log("Error, ignoreNotFoundTrue: ", err.toLocaleString())
                return {
                    status: 'OK'
                }
            }
            console.log("Error indexing documentId: " + indexedDocumentId + ' for index: ' + collection );
            console.log('replaceDocument error: ', err.toLocaleString());
            return {
                status: 'BAD',
                error: "Error indexing documentId: " + indexedDocumentId + ' for index: ' + collection
            }
        }
    }

    private async indexDocuments(dataSet: Array<IIndexFormat>) {
        const connection = await this.connect();
        const errors: Array<string> = [];
        let successCount = 0
        for (let ii = 0; ii < dataSet.length; ii++) {
            const data = dataSet[ii];

            const result = await this.indexSingleDocument(connection, data);

            if (result.error) {
                errors.push(result.error)
            }
            else {
                if (result.status && result.status === 'OK') {
                    successCount = successCount + 1;
                }
            }
        }

        return {
            documentCount: dataSet.length,
            successCount,
            errors
        }
    }

    public async indexSingleDocument(connection: Db, data: IIndexFormat): Promise<{status: string, error?: string}> {
        try {
            const results = await connection.collection(data.index).find({indexedDocumentId: data.indexedDocumentId}).toArray();

            if (!results || results.length === 0) {
                await connection.collection(data.index).insertOne(data.document);
            }
            else if (results.length === 1) {
                await connection.collection(data.index).updateOne({_id: results[0]._id}, {$set: data.document}, {upsert: true});
            }
            else {
                for (let ii = 0; ii < results.length; ii++) {
                    if (ii === 0) {
                        await connection.collection(data.index).updateOne({_id: results[ii]._id}, {$set: data.document}, {upsert: true});
                    }
                    else {
                        await connection.collection(data.index).deleteOne({_id: results[ii]._id});
                    }
                }
            }
            return {
                status: 'OK'
            }
        }
        catch (err: any) {
            console.log("Error indexing documentId: " + data.index + ' for index: ' + data.index );
            console.log('indexSingleDocument error: ', err.toLocaleString());
            return {
                status: 'BAD',
                error: "Error indexing documentId: " + data.index + ' for index: ' + data.index
            }
        }
    }

    private async performRequest(urlSuffix: string, config: any) {
        const url = 'https://cloud.mongodb.com/api/atlas/v1.0' + urlSuffix;
        const options: AxiosRequestConfig = {
            url,
            headers: {'Content-Type': 'application/json'},
            digestAuth: `${this.mongoAtlasUser}:${this.mongoAtlasUserKey}`,
            ...config
        };

        try {
            const result = await this.digestAuth.request(options as any);

            if (result) {
                return result.data;
            }
        } catch (err: any) {
            console.log('Error communicating with index service: ', err);
            if (err.response) {
                console.log('status: ' + err.response.status);
                console.log('data: ', err.response.data);
                if (err.response.status === 400) {
                    if (err.response.data && err.response.data.detail) {
                        throw {code: err.response.status, error: err.response.data.detail};
                    }
                    else {
                        throw {code: err.response.status, error: 'Bad Mongodb Atlas Search API Request'};
                    }
                }
                if (err.response.status === 500) {
                    throw {code: 400, error: 'Communication Failure with Atlas Search API'};
                }
                if (err.response.status === 404) {
                    throw {code: 400, error: 'Mongodb Atlas Search API Request Not Found Error'};
                }
            }
            console.log(err);
        }
        throw {code: 500, error: 'Failed to communicate with Mongo Atlas Search API'};
    }
}
