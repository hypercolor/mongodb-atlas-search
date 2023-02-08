import {IGenericFormat} from "./i-generic-format";


export interface IMongoTextSearchFormat {
  searchMust: Array<IGenericFormat>,
  searchShould: Array<IGenericFormat>,
  searchSort: IGenericFormat
}
