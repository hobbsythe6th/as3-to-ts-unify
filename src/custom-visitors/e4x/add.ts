import Node from '../../syntax/node';
import * as Operators from '../../syntax/operators'
import Emitter, { visitNode, visitNodes } from '../../emit/emitter';
import * as assert from 'assert';

import { producesXmlOrXmlListValue } from './lib';

export default function(emitter: Emitter, node: Node) {

    const lhs = node.children[0];
    const op = node.children[1];
    const rhs = node.children[2];
    
    if (op.text === Operators.PLUS && producesXmlOrXmlListValue(emitter, lhs) && producesXmlOrXmlListValue(emitter, rhs)) {

        assert(node.children.length === 3); // no support yet for chained additions
        
        emitter.catchup(node.start);
        visitNode(emitter, lhs);
        emitter.catchup(lhs.end);
        
        emitter.insert('.');
        emitter.insert('plus');
        emitter.insert('(');
            emitter.skipTo(rhs.start);
            visitNode(emitter, rhs);
            emitter.catchup(node.end);
        emitter.insert(')');
        
        return true;
    }

    return false;
}
