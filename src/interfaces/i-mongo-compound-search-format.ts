import {IGenericFormat} from "./i-generic-format";


export interface IMongoCompoundSearchFormat {
  filter: Array<IGenericFormat>,
  must: Array<IGenericFormat>,
  mustNot: Array<IGenericFormat>,
  should: Array<IGenericFormat>,
  sort: IGenericFormat,
}
