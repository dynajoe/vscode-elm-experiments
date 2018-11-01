import * as vscode from 'vscode'
import * as Path from 'path'
import * as Fs from 'fs'
import * as Os from 'os'
import * as _ from 'lodash'
import * as FastGlob from 'fast-glob'
import { Module, parseElmModule } from 'elm-module-parser'

interface ElmProjectDefinition {
   json: any
   project_type: 'application' | 'package'
   path: string
   version: string
   source_dirs: string[]
   dependencies: {
      name: string
      version: string
      package_path: string
   }[]
}

export class ElmProjectManager {
   private projects: ElmProjectDefinition[] = []

   private cache: {
      [module_path: string]: {
         parsed: Module
         module_name: string
         module_path: string
      }
   } = {}

   constructor(private workspace_paths: string[]) {}

   public async moduleFromName(contextual_path: string, module_name: string): Promise<Module | null> {
      const elm_project = await this.projectDefinitionForPath(contextual_path)

      if (_.isNil(elm_project)) {
         return null
      }

      const possible_paths = this.moduleNameToPaths(elm_project, module_name)

      for (const path of possible_paths) {
         const module = await this.moduleFromPath(path)

         if (!_.isNil(module)) {
            return module
         }
      }

      return null
   }

   public async moduleFromPath(module_path: string): Promise<Module | null> {
      if (this.cache[module_path]) {
         return this.cache[module_path].parsed
      }

      const module_text = await this.readFileOrNull(module_path)

      if (_.isNil(module_text)) {
         return null
      }

      try {
         const parsed_module = parseElmModule(module_text)

         this.cache[module_path] = {
            module_path: module_path,
            module_name: parsed_module.name,
            parsed: parsed_module,
         }

         return parsed_module
      } catch (error) {
         return null
      }
   }

   public invalidatePath(module_path: string): ElmProjectManager {
      delete this.cache[module_path]
      return this
   }

   public async projectDefinitionForPath(contextual_path: string): Promise<ElmProjectDefinition | null> {
      if (_.isEmpty(this.projects)) {
         this.projects = await this.loadElmProjects()
      }

      const probable_project = this.projects.find(x => !_.isNil(x.source_dirs.find(d => contextual_path.startsWith(d))))

      if (_.isNil(probable_project)) {
         return null
      }

      return probable_project
   }

   private async readFileOrNull(document_path: string): Promise<string | null> {
      try {
         return await new Promise<string>((resolve, reject) => {
            Fs.readFile(document_path, (err, data) => {
               if (err) {
                  return reject(err)
               } else {
                  return resolve(data.toString('utf-8'))
               }
            })
         })
      } catch (error) {
         return null
      }
   }

   private async loadElmProjects(): Promise<ElmProjectDefinition[]> {
      const elm_project_entries = (await FastGlob(
         this.workspace_paths
            .map(p => Path.join(p, '**/elm.json'))
            .concat(this.workspace_paths.map(p => Path.join(p, '**/elm-package.json')))
            .concat('!**/node_modules/**')
      )) as string[]

      if (_.isEmpty(elm_project_entries)) {
         return []
      } else {
         const projects = await Promise.all(
            elm_project_entries.map(async project_entry => {
               try {
                  const elm_project_doc = await this.readFileOrNull(project_entry)

                  if (_.isNil(elm_project_doc)) {
                     return null
                  }

                  const elm_project_json = JSON.parse(elm_project_doc)
                  const direct_dependencies = _.get(elm_project_json, 'dependencies.direct', [])

                  const dependencies = _.keys(direct_dependencies).map(pkg => {
                     const elm_dependencies_dir =
                        process.platform === 'win32'
                           ? Path.join(process.env['appdata']!, 'elm')
                           : Path.join(Os.homedir(), `.elm/${elm_project_json['elm-version']}/package`)

                     return {
                        name: pkg,
                        version: direct_dependencies[pkg],
                        package_path: Path.join(elm_dependencies_dir, pkg, direct_dependencies[pkg]),
                     }
                  })

                  return {
                     project_type: <'application'>'application',
                     path: project_entry,
                     version: elm_project_json['elm-version'],
                     source_dirs: elm_project_json['source-directories'].map((d: string) =>
                        Path.join(Path.dirname(project_entry), d)
                     ),
                     dependencies: dependencies,
                     json: elm_project_json,
                  }
               } catch (error) {
                  return null
               }
            })
         )

         return _.compact(projects)
      }
   }

   private moduleNameToPaths(elm_project: ElmProjectDefinition, module_name: string): string[] {
      const module_relative_path = `${module_name.replace(/[.]/g, Path.sep)}.elm`

      return elm_project.source_dirs
         .map(d => Path.join(d, module_relative_path))
         .concat(elm_project.dependencies.map(d => Path.join(d.package_path, 'src', module_relative_path)))
   }
}

const globalProjectManager = new ElmProjectManager((vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath))

export function getGlobalProjectManager(): ElmProjectManager {
   return globalProjectManager
}
