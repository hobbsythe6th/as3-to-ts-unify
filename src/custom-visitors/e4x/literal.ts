import Node from '../../syntax/node';
import Emitter from '../../emit/emitter';
import * as assert from 'assert';

export default function(emitter: Emitter, node: Node) {
    emitter.catchup(node.start);

    let constructorArg = node.text
        .replace(/`/g, '\\`')   // escape all backticks, because we're going to surround the string with backticks for interpretation

    // replace all top-level instances of '{' with '${'
    {
        let indicesOfOpeningBraces: number[] = [];
        let braceDepth = 0;
        for (let i = 0; i < constructorArg.length; ++i) {
            if (constructorArg[i] === '{') {
                if (braceDepth === 0) {
                    indicesOfOpeningBraces.push(i);
                }
                braceDepth++;
            } else if (constructorArg[i] === '}') {
                braceDepth--;
                assert(braceDepth >= 0);    // we never have more closing braces then opening braces when scanning
            }
        }
        assert(braceDepth === 0);   // we have equally paired braces

        while (indicesOfOpeningBraces.length > 0) { // walk backwards through the string so all the indices stay correct until we edit that spot in the string
            let indexOfOpeningBrace = indicesOfOpeningBraces.pop();
            constructorArg = constructorArg.slice(0, indexOfOpeningBrace) + '${' + constructorArg.slice(indexOfOpeningBrace + 1);
        }
    }

    emitter.insert('new XML');
    emitter.insert('(');
        emitter.insert('`' + constructorArg + '`');
    emitter.insert(')');

    emitter.skipTo(node.end);

    return true;
}
