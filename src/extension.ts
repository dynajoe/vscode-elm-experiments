import * as vscode from 'vscode'
import { registerElmCompetionProviders } from './elm_completion'

export function activate(context: vscode.ExtensionContext) {
   registerElmCompetionProviders(context)
}

export function deactivate() {}
