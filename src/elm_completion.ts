import * as vscode from 'vscode'
import { getGlobalProjectManager } from './elm_project'
import * as _ from 'lodash'
import { Module, ModuleImport, exposedOnlyView } from 'elm-module-parser'

type ModuleContext = 'function' | 'import' | 'type' | 'module'

export class ElmCompletionProvider implements vscode.CompletionItemProvider {
   async provideCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      cancellation: vscode.CancellationToken,
      completion_context: vscode.CompletionContext
   ): Promise<vscode.CompletionItem[]> {
      const word_range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_+-/*=.<>:&|^?%!]+/)

      if (_.isNil(word_range)) {
         return []
      }

      const elm_project_manager = getGlobalProjectManager()

      elm_project_manager.invalidatePath(document.fileName)

      const elm_module = await elm_project_manager.moduleFromPath(document.fileName)

      if (_.isNil(elm_module)) {
         return []
      }

      const { context, text, prefix } = this.determineContext(elm_module, document, position)

      const possible_imports = _.filter(
         elm_module.imports,
         (i: ModuleImport): boolean => i.module.startsWith(_.isEmpty(prefix) ? text : prefix)
      )

      const import_views = _(
         await Promise.all(
            possible_imports.map(i => getGlobalProjectManager().moduleFromName(document.fileName, i.module))
         )
      )
         .compact()
         .map(i => ({ module: i, view: exposedOnlyView(i) }))
         .value()

      if (context === 'function') {
         return _.concat(
            elm_module.function_declarations.map(d => {
               return new vscode.CompletionItem(d.name, vscode.CompletionItemKind.Function)
            }),
            _.flatMap(import_views, v => {
               return v.view.functions.map(f => {
                  return new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function)
               })
            }),
            _.flatMap(import_views, i => {
               return _.flatMap(i.view.custom_types, t => {
                  return t.constructors.map(c => new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Class))
               })
            })
         )
      } else if (context === 'module') {
         return _(import_views)
            .flatMap(view => {
               const completion_parts = _(view.view.name.split(/[.]/g))
                  .zipWith(prefix.split(/[.]/g))
                  .takeRightWhile(([a, b]) => a !== b)
                  .map(([a]) => a)
                  .value()

               if (_.isEmpty(completion_parts)) {
                  return view.view.functions.map(t => {
                     const fn = new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Function)
                     fn.detail = view.module.text.substring(t.location.start.offset, t.location.start.offset + 100)

                     return fn
                  })
               } else {
                  return new vscode.CompletionItem(completion_parts.join('.'), vscode.CompletionItemKind.Class)
               }
            })
            .value()
      }

      return []
   }

   // public async resolveCompletionItem(
   //    completion_item: vscode.CompletionItem
   // ): Promise<vscode.CompletionItem | undefined> {
   //    return completion_item.
   // }

   determineContext(
      elm_module: Module,
      document: vscode.TextDocument,
      position: vscode.Position
   ): { context: ModuleContext; prefix: string; text: string } {
      const word_range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_.]+/)
      const word = document.getText(word_range)
      const current_word = word.substring(word.lastIndexOf('.') + 1)
      const prefix = word.substring(0, word.lastIndexOf('.'))

      if (prefix !== '' || current_word[0].match(/[A-Z]/)) {
         return { context: 'module', prefix: prefix.trim(), text: current_word.trim() }
      }

      return { context: 'function', prefix: '', text: current_word.trim() }
   }
}

const ELM_MODE: vscode.DocumentFilter = { language: 'elm', scheme: 'file' }

export function registerElmCompetionProviders(context: vscode.ExtensionContext) {
   const completion_provider = vscode.languages.registerCompletionItemProvider(ELM_MODE, new ElmCompletionProvider())

   vscode.workspace.onDidSaveTextDocument(d => {
      getGlobalProjectManager().invalidatePath(d.fileName)
   })

   context.subscriptions.push(completion_provider)
}
