import { classBound } from "undefinedclassBound";
﻿
@classBound
export class ForEachSimple
{
    constructor(){
        var myObj:any = {a:2, b:3, c:40};
        for (value of myObj)
        {
            console.log(this.value);
        }
    }

}
