import Node from '../../syntax/node';
import NodeKind from '../../syntax/nodeKind';
import Emitter from '../../emit/emitter';
import {isAnAccessorOnAnXmlOrXmlListValue} from './lib';
import * as assert from 'assert';

export default function(emitter: Emitter, node: Node) {

    let representsAFunction = node.parent.kind == NodeKind.CALL;
    
    if (isAnAccessorOnAnXmlOrXmlListValue(emitter, node)) {
        
        assert(node.text.indexOf('*') === -1);  // no code yet to include accessing either '*' or '@*' in an unqualified way inside a filter callback
        
        if (representsAFunction) {
            // turn:
            //    ident()
            // into:
            //    n$.ident()
            
            emitter.catchup(node.start);
            emitter.insert(`n$.${node.text}`);
            emitter.skipTo(node.end);
            
        } else {
            // turn:
            //    ident
            //    @ident
            // into:
            //    n$.$get('ident')
            //    n$.$getAttribute('ident')
            // respectively

            // General approach:
            //  1. emit 'n$'
            //  2. emit .$get( or .$getAttribute(
            //  3. emit ident
            //  4. emit ')'

            //  1. emit 'n$'
            emitter.catchup(node.start);
            emitter.insert('n$');

            let isReferencingAnAttribute = node.text[0] === '@';

            //  2. emit .$get( or .$getAttribute(
            if (isReferencingAnAttribute) {
                emitter.insert('.$getAttribute(');
            } else {
                emitter.insert('.$get(');
            }

            //  3. emit ident
            emitter.insert(`'${isReferencingAnAttribute ? node.text.slice(1) : node.text}'`);

            //  4. emit ')'
            emitter.insert(')');

            emitter.skipTo(node.end);
        }
        
        return true;
    } else if (node.text === 'XML' || node.text === 'XMLList') {
        // replace calls to 'XML/XMLList' that aren't explicitly creating a 'new' object with calls to equivalent static functions
        
        let targetOfACallToNew = node.parent.parent.kind === NodeKind.NEW;
        
        if (representsAFunction && !targetOfACallToNew) {
            emitter.catchup(node.start);
            emitter.insert(node.text);
            emitter.insert('.');
            emitter.insert(node.text === 'XML' ? 'convertToXml' : 'convertToXmlList');
            emitter.skipTo(node.end);
            
            return true;
        }
    }
    
    return false;
}
