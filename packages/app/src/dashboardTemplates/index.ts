import {
  type DashboardTemplate,
  DashboardTemplateSchema,
} from '@hyperdx/common-utils/dist/types';

import dotnetRuntime from './dotnet-runtime.json';
import goRuntime from './go-runtime.json';
import jvmRuntimeMetrics from './jvm-runtime-metrics.json';
import nodejsRuntime from './nodejs-runtime.json';

function parseTemplate(
  id: string,
  json: unknown,
): DashboardTemplate | undefined {
  const result = DashboardTemplateSchema.safeParse(json);
  if (!result.success) {
    // This should not happen, we have a unit test to catch invalid templates.
    console.error(`Error parsing dashboard template "${id}":`, result.error);
    return undefined;
  }
  return result.data;
}

const templates: Record<string, unknown> = {
  'dotnet-runtime': dotnetRuntime,
  'go-runtime': goRuntime,
  'jvm-runtime-metrics': jvmRuntimeMetrics,
  'nodejs-runtime': nodejsRuntime,
};

export const DASHBOARD_TEMPLATES = Object.entries(templates)
  .map(([id, template]) => {
    const parsedTemplate = parseTemplate(id, template);
    if (!parsedTemplate) {
      return undefined;
    }

    return {
      id,
      name: parsedTemplate.name,
      description: parsedTemplate.description ?? '',
      tags: parsedTemplate.tags ?? [],
    };
  })
  .filter(t => t !== undefined);

export function getDashboardTemplate(
  id: string,
): DashboardTemplate | undefined {
  const json = templates[id];
  return parseTemplate(id, json);
}
