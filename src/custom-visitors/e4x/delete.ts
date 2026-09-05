import Node from '../../syntax/node';
import NodeKind from '../../syntax/nodeKind';
import * as Keywords from '../../syntax/keywords';
import Emitter, { visitNode } from '../../emit/emitter';
import * as assert from 'assert';

import { isAnAccessorOnAnXmlOrXmlListValue } from './lib';

export default function(emitter: Emitter, node: Node) {
    assert(node.children.length === 1);
    const deleteTarget = node.children[0];

    if (isAnAccessorOnAnXmlOrXmlListValue(emitter, deleteTarget)) {

        let root = deleteTarget.children[0];
        let tail = deleteTarget.children[1];    // will be undefined if deleteTarget.kind === NodeKind.E4X_STAR

        // turn:
        //    delete root.tail     // (includes tail === '*')
        //    delete root.@tail     // (includes tail === '*')
        //    delete root[tail]
        //    delete root.@[tail]
        // into:
        //    root.$delete('tail')
        //    root.$deleteAttribute('tail')
        //    root.$delete(tail)
        //    root.$deleteAttribute(tail)
        // respectively

        // General approach:
        //  1. catchup to 'delete', then skip to root
        //  2. emit root
        //  3. emit .$delete( or .$deleteAttribute(
        //  4. emit tail
        //  5. emit ')'
        //  6. skip to end of node, to avoid any trailing ']'

        //  1. catchup to 'delete', then skip to root
        emitter.catchup(node.start);
        emitter.skipTo(root.start);
        
        //  2. emit root
        visitNode(emitter, root);
        emitter.catchup(root.end);
        
        //  3. emit .$delete( or .$deleteAttribute(
        if (deleteTarget.kind === NodeKind.DOT || deleteTarget.kind === NodeKind.ARRAY_ACCESSOR || deleteTarget.kind === NodeKind.E4X_STAR) {
            emitter.insert('.$delete(');
        } else if (deleteTarget.kind === NodeKind.E4X_ATTR || deleteTarget.kind === NodeKind.E4X_ATTR_ARRAY_ACCESS) {
            emitter.insert('.$deleteAttribute(');
        } else {
            assert(false);
        }
        
        //  4. emit tail
        if (deleteTarget.kind === NodeKind.DOT || deleteTarget.kind === NodeKind.E4X_ATTR) {
            assert(tail.kind === NodeKind.LITERAL);
            emitter.insert(`'${tail.text}'`);
        } else if (deleteTarget.kind === NodeKind.E4X_STAR) {
            assert(typeof tail === 'undefined');
            emitter.insert(`'*'`);
        } else if (deleteTarget.kind === NodeKind.ARRAY_ACCESSOR || deleteTarget.kind === NodeKind.E4X_ATTR_ARRAY_ACCESS) {
            emitter.skipTo(tail.start);
            visitNode(emitter, tail);
            emitter.catchup(tail.end);
        } else {
            assert(false);
        }
        
        //  5. emit ')'
        emitter.insert(')');
        
        //  6. skip to end of node, to avoid any trailing ']'
        emitter.skipTo(node.end);
        
        return true;
    }

    return false;
}
