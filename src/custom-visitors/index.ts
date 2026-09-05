import Node from "../syntax/node";
import Emitter, { EmitterOptions, ImportStatement } from "../emit/emitter";

export interface CustomVisitor {
    visit: (emitter: Emitter, node: Node) => boolean;
    imports?: Map<RegExp, string>;
    preProcessing?: (emitterOptions: EmitterOptions, data: string, pathToFile: string) => string;
    postProcessing?: (emitterOptions: EmitterOptions, data: string) => string;
    typeMap?: { [id: string]: string };
    identifierMap?: { [id: string]: string };
    respondToExtraImportsNeeded?: (extraImportsNeeded: ImportStatement[]) => void;
}
