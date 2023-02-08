export interface IPaginatedOutput {
  meta: {
    count: number,
    page: number,
    pageSize: number,
    total: number
    verbose: boolean,
  },
  items: Array<any>
}
