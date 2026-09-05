import Node from '../../syntax/node';
import NodeKind from '../../syntax/nodeKind';
import Emitter, { visitNode } from '../../emit/emitter';
import * as assert from 'assert';

import { isAnAccessorOnAnXmlOrXmlListValue, getExpressionType } from './lib';

export default function emitAccessor(emitter: Emitter, node: Node) {
    if (isAnAccessorOnAnXmlOrXmlListValue(emitter, node)) {

        if (node.kind === NodeKind.DOT && node.parent.kind == NodeKind.CALL) {
            // this is a method call on an XML/XMLList object, which shouldn't be transformed
            return false;
        }

        let root = node.children[0];
        let tail = node.children[1];    // will be undefined if node.kind === NodeKind.E4X_STAR
        
        // turn:
        //    root.tail     // (includes tail === '*')
        //    root.@tail     // (includes tail === '*')
        //    root[<provably a number>]
        //    root[tail]
        //    root.@[tail]
        // into:
        //    root.$get('tail')
        //    root.$getAttribute('tail')
        //    root.atIndex(<provably a number>)
        //    root.$get(tail)
        //    root.$getAttribute(tail)
        // respectively

        // NOTE: some comments/whitespace in original source will be lost, due to what information is retained by the parser, but this is currently acceptable
        // I.e. this:
        //      root/*comment lost*/ . /*comment lost*/ tail
        //      root/*comment lost*/ . /*comment lost*/ @[ /*comment lost*/ tail /*comment lost*/ ]
        // becomes this:
        //      root.$get('tail')
        //      root.$getAttribute(tail)

        // General approach:
        //  1. emit root
        //  2. emit .$get( or .$getAttribute( or .atIndex(
        //  3. emit tail
        //  4. emit ')'
        //  5. skip to end of node, to avoid any trailing ']'

        //  1. emit root
        visitNode(emitter, root);
        emitter.catchup(root.end);

        //  2. emit .$get( or .$getAttribute(
        if (node.kind === NodeKind.DOT || node.kind === NodeKind.ARRAY_ACCESSOR || node.kind === NodeKind.E4X_STAR) {
            if (node.kind === NodeKind.ARRAY_ACCESSOR && getExpressionType(emitter, tail) === 'number') {
                emitter.insert('.atIndex(');
            } else {
                emitter.insert('.$get(');
            }
        } else if (node.kind === NodeKind.E4X_ATTR || node.kind === NodeKind.E4X_ATTR_ARRAY_ACCESS) {
            emitter.insert('.$getAttribute(');
        } else {
            assert(false);
        }

        //  3. emit tail
        if (node.kind === NodeKind.DOT || node.kind === NodeKind.E4X_ATTR) {
            assert(tail.kind === NodeKind.LITERAL);
            emitter.insert(`'${tail.text}'`);
        } else if (node.kind === NodeKind.E4X_STAR) {
            assert(typeof tail === 'undefined');
            emitter.insert(`'*'`);
        } else if (node.kind === NodeKind.ARRAY_ACCESSOR || node.kind === NodeKind.E4X_ATTR_ARRAY_ACCESS) {
            emitter.skipTo(tail.start);
            visitNode(emitter, tail);
            emitter.catchup(tail.end);
        } else {
            assert(false);
        }

        //  4. emit ')'
        emitter.insert(')');
        
        //  5. skip to end of node, to avoid any trailing ']'
        emitter.skipTo(node.end);
        
        return true;
    }

    return false;
}