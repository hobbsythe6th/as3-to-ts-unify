import { DebugClass } from "./DebugClass";
import { classBound } from "undefinedclassBound";

@classBound
export class DynamicCasting
{
	constructor(){
        return (<DebugClass>(new pRootClass()) );
	}
}


