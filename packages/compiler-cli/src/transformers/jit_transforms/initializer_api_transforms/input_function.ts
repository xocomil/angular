/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {core} from '@angular/compiler';
import ts from 'typescript';

import {isAngularDecorator, tryParseSignalInputMapping} from '../../../ngtsc/annotations';

import {PropertyTransform} from './transform_api';

/**
 * Transform that will automatically add an `@Input` decorator for all signal
 * inputs in Angular classes. The decorator will capture metadata of the signal
 * input, derived from the `input()/input.required()` initializer.
 *
 * This transform is useful for JIT environments where signal inputs would like to be
 * used. e.g. for Angular CLI unit testing. In such environments, signal inputs are not
 * statically retrievable at runtime. JIT compilation needs to know about all possible inputs
 * before instantiating directives. A decorator exposes this information to the class without
 * the class needing to be instantiated.
 */
export const signalInputsTransform: PropertyTransform = (
    member,
    host,
    factory,
    importManager,
    decorator,
    isCore,
    ) => {
  // If the field already is decorated, we handle this gracefully and skip it.
  if (host.getDecoratorsOfDeclaration(member)?.some(d => isAngularDecorator(d, 'Input', isCore))) {
    return member;
  }

  const inputMapping = tryParseSignalInputMapping(
      {name: member.name.text, value: member.initializer ?? null},
      host,
      isCore,
  );
  if (inputMapping === null) {
    return member;
  }

  const fields: Record<keyof Required<core.Input>, ts.Expression> = {
    'isSignal': factory.createTrue(),
    'alias': factory.createStringLiteral(inputMapping.bindingPropertyName),
    'required': inputMapping.required ? factory.createTrue() : factory.createFalse(),
    // For signal inputs, transforms are captured by the input signal. The runtime will
    // determine whether a transform needs to be run via the input signal, so the `transform`
    // option is always `undefined`.
    'transform': factory.createIdentifier('undefined'),
  };

  const classDecoratorIdentifier = ts.isIdentifier(decorator.identifier) ?
      decorator.identifier :
      decorator.identifier.expression;

  const newDecorator = factory.createDecorator(
      factory.createCallExpression(
          factory.createPropertyAccessExpression(
              importManager.generateNamespaceImport('@angular/core'),
              // The synthetic identifier may be checked later by the downlevel decorators
              // transform to resolve to an Angular import using `getSymbolAtLocation`. We trick
              // the transform to think it's not synthetic and comes from Angular core.
              ts.setOriginalNode(factory.createIdentifier('Input'), classDecoratorIdentifier)),
          undefined,
          [factory.createAsExpression(
              factory.createObjectLiteralExpression(Object.entries(fields).map(
                  ([name, value]) => factory.createPropertyAssignment(name, value))),
              // Cast to `any` because `isSignal` will be private, and in case this
              // transform is used directly as a pre-compilation step, the decorator should
              // not fail. It is already validated now due to us parsing the input metadata.
              factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))]),
  );

  return factory.updatePropertyDeclaration(
      member,
      [newDecorator, ...(member.modifiers ?? [])],
      member.name,
      member.questionToken,
      member.type,
      member.initializer,
  );
};
