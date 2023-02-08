import {IGenericFormat} from "./i-generic-format";

export interface IIndexFormat {
    index: string,
    indexedDocumentId: string,
    document: IGenericFormat
}