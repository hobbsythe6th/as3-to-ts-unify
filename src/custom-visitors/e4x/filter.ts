import Node from '../../syntax/node';
import Emitter, { visitNode } from '../../emit/emitter';
import * as assert from 'assert';

export default function(emitter: Emitter, node: Node) {
    assert(node.children.length === 2);
    
    const filterTarget = node.children[0];
    const filterExpression = node.children[1];

    // turn:
    //    filterTarget.(filterExpression)
    // into:
    //    filterTarget.filter(n$ => filterExpression)

    visitNode(emitter, filterTarget);
    emitter.catchup(filterTarget.end);
    
    assert(emitter.sourceBetween(emitter.index, emitter.index + 2) === '.('); // ensure we aren't skipping any comments between these tokens
    
    emitter.skip(2);    // skip the '.('
    emitter.insert(`.filter(n$ =>`);
    // ensure there's a space after the fat arrow
    if (/\S/.test(emitter.sourceBetween(emitter.index, emitter.index + 1))) {
        emitter.insert(' ');
    }

    visitNode(emitter, filterExpression);
    
    emitter.catchup(node.end);  // catchup all the way to the end ')', for good measure

    return true;
}
