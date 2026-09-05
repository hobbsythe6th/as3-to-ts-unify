import Node from '../../syntax/node';
import NodeKind from '../../syntax/nodeKind';
import * as Operators from '../../syntax/operators'
import Emitter, { visitNode, visitNodes } from '../../emit/emitter';
import * as assert from 'assert';

import {
    isAnAccessorOnAnXmlOrXmlListValue, producesXmlOrXmlListValue, producesXmlListValue,
    getConversionFunctionNameFromTypeScriptType, emitExpressionWithConversion, getExpressionType
} from './lib';

export default function(emitter: Emitter, node: Node) {
    assert(node.children.length === 3);    // not yet coding to handle multiple assignments in a row here
    
    const lhs = node.children[0];
    const op = node.children[1];
    const rhs = node.children[2];
    
    if (isAnAccessorOnAnXmlOrXmlListValue(emitter, lhs)) {

        assert(op.text === Operators.EQUAL);    // we have no logic yet to handle expressions like '+=' when the rhs is XML/XMLList, so assert if something like this is encountered

        let root = lhs.children[0];
        let tail = lhs.children[1];    // will be undefined if lhs.kind === NodeKind.E4X_STAR
        
        // turn:
        //    root.tail = rhs     // (includes tail === '*')
        //    root.@tail = rhs     // (includes tail === '*')
        //    root[tail] = rhs
        //    root.@[tail] = rhs
        // into:
        //    root.$put('tail', rhs)
        //    root.$putAttribute('tail', rhs)
        //    root.$put(tail, rhs)
        //    root.$putAttribute(tail, rhs)
        // respectively
        
        // NOTE: some comments/whitespace in original source will be lost, due to what information is retained by the parser, but this is currently acceptable
        // I.e. this:
        //      root/*comment lost*/ . /*comment lost*/ tail /*comment lost*/ = /*comment kept*/ rhs
        // becomes this:
        //      root.$put('tail', /*comment kept*/ rhs)
        
        // General approach:
        //  1. emit root
        //  2. emit .$put( or .$putAttribute(
        //  3. emit tail
        //  4. emit ','
        //  5. emit everything between operator and rhs
        //  6. emit rhs
        //  7. catchup to end of rhs
        //  8. emit ')'

        //  1. emit root
        visitNode(emitter, root);
        emitter.catchup(root.end);

        //  2. emit .$put( or .$putAttribute(
        if (lhs.kind === NodeKind.DOT || lhs.kind === NodeKind.ARRAY_ACCESSOR || lhs.kind === NodeKind.E4X_STAR) {
            emitter.insert('.$put(');
        } else if (lhs.kind === NodeKind.E4X_ATTR || lhs.kind === NodeKind.E4X_ATTR_ARRAY_ACCESS) {
            emitter.insert('.$putAttribute(');
        } else {
            assert(false);
        }

        //  3. emit tail
        if (lhs.kind === NodeKind.DOT || lhs.kind === NodeKind.E4X_ATTR) {
            assert(tail.kind === NodeKind.LITERAL);
            emitter.insert(`'${tail.text}'`);
        } else if (lhs.kind === NodeKind.E4X_STAR) {
            assert(typeof tail === 'undefined');
            emitter.insert(`'*'`);
        } else if (lhs.kind === NodeKind.ARRAY_ACCESSOR || lhs.kind === NodeKind.E4X_ATTR_ARRAY_ACCESS) {
            emitter.skipTo(tail.start);
            visitNode(emitter, tail);
            emitter.catchup(tail.end);
        } else {
            assert(false);
        }
        
        //  4. emit ','
        emitter.insert(',');
        
        //  5. emit everything between operator and rhs
        emitter.skipTo(op.end);
        emitter.catchup(rhs.start);
        
        //  6. emit rhs
        visitNode(emitter, rhs);
        
        //  7. catchup to end of rhs
        emitter.catchup(rhs.end);
        
        //  8. emit ')'
        emitter.insert(')');
        
        return true;
    } else if (op.text === Operators.PLUS_EQUAL && producesXmlOrXmlListValue(emitter, lhs)) {

        emitter.catchup(node.start);
        visitNode(emitter, lhs);
        emitter.catchup(op.start);
        emitter.insert('=');
        emitter.skipTo(op.end);
        emitter.catchup(rhs.start);

        emitter.skipTo(lhs.start);
        visitNode(emitter, lhs);
        emitter.catchup(lhs.end);

        emitter.insert('.plus');
        emitter.insert('(');
            emitter.skipTo(rhs.start);
            visitNode(emitter, rhs);
            emitter.catchup(rhs.end);
        emitter.insert(')');
        
        return true;
    } else if (op.text === Operators.EQUAL && producesXmlOrXmlListValue(emitter, rhs)) {

        // ActionScript appears to perform some auto-conversions from XMLList to 'String', 'Number', 'int', 'unit', and 'XML'
        // based on what the type of the receiving variable when doing assignment.
        // So we'll to detect such situations and inject the needed conversions explicitly

        let typeOfTargetVar = getExpressionType(emitter, lhs);
        
        if (typeOfTargetVar !== getExpressionType(emitter, rhs)) {

            let conversionFunctionName = getConversionFunctionNameFromTypeScriptType(emitter, typeOfTargetVar);

            if (conversionFunctionName) {
                assert(node.children.length === 3);

                visitNodes(emitter, [lhs, op]);
                emitExpressionWithConversion(emitter, rhs, conversionFunctionName);
                return true;
            }
        }
    }
    
    return false;
}
