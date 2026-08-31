import { classBound } from "undefinedclassBound";
  
@classBound
export class GetSet {

    constructor(){

    }

    public get thing():string[] {
      return <string[]>(['a thing']);
    }
  }

