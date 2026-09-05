import { classBound } from "undefinedclassBound";

@classBound
export class ClassMember
{
	public myVar:number = 100;
	constructor(){
		var myVar:number = 10;
		console.log(myVar);
	}
}

