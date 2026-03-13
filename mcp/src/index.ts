#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Resolve the agent-device binary relative to this package.
// mcp/dist/index.js → mcp/ → agent-device/ → bin/agent-device.mjs
const AD_BIN = resolve(__dirname, '..', '..', 'bin', 'agent-device.mjs');

type AdResult = { success: true; data: unknown } | { success: false; error: string };

function runAd(args: string[], opts?: { session?: string; device?: string; platform?: string }): AdResult {
  const extraArgs: string[] = [];
  if (opts?.session) extraArgs.push('--session', opts.session);
  if (opts?.device) extraArgs.push('--device', opts.device);
  if (opts?.platform) extraArgs.push('--platform', opts.platform);

  const result = spawnSync(process.execPath, [AD_BIN, ...args, ...extraArgs, '--json'], {
    encoding: 'utf8',
    timeout: 90_000,
  });

  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();

  if (result.error) {
    return { success: false, error: result.error.message };
  }

  if (result.status !== 0) {
    let errorMsg = stderr || `agent-device exited with code ${result.status}`;
    try {
      const parsed = JSON.parse(stdout) as { success?: boolean; error?: { message?: string; hint?: string } };
      if (parsed.error?.message) {
        errorMsg = parsed.error.hint
          ? `${parsed.error.message}\nHint: ${parsed.error.hint}`
          : parsed.error.message;
      }
    } catch {
      // use raw stderr
    }
    return { success: false, error: errorMsg };
  }

  try {
    const parsed = JSON.parse(stdout) as unknown;
    return { success: true, data: parsed };
  } catch {
    return { success: true, data: stdout || null };
  }
}

function ok(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

const server = new Server(
  { name: 'agent-device-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ad_devices',
      description: 'List all available iOS and Android devices/emulators.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          platform: { type: 'string', enum: ['ios', 'android'], description: 'Filter by platform.' },
        },
      },
    },
    {
      name: 'ad_open',
      description: 'Open an app on a device, creating a session. Returns session info.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name (default: "default").' },
          bundle_id: { type: 'string', description: 'App bundle ID / package name.' },
          device: { type: 'string', description: 'Device ID or name.' },
          platform: { type: 'string', enum: ['ios', 'android'], description: 'Platform.' },
        },
        required: ['bundle_id'],
      },
    },
    {
      name: 'ad_close',
      description: 'Close/terminate an active session.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name (default: "default").' },
        },
      },
    },
    {
      name: 'ad_session_list',
      description: 'List all active sessions.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'ad_apps',
      description: 'List installed apps on the device in the session.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
        },
      },
    },
    {
      name: 'ad_snapshot',
      description:
        'Capture the current UI accessibility tree. Returns a tree of elements with refs like @e1, @e2 that can be used in subsequent commands.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          mask: { type: 'boolean', description: 'Mask sensitive text fields.' },
        },
      },
    },
    {
      name: 'ad_screenshot',
      description: 'Take a screenshot. Returns the path to the saved PNG.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          out: { type: 'string', description: 'Output file path (optional).' },
        },
      },
    },
    {
      name: 'ad_find',
      description: 'Semantically find a UI element using a natural-language description.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          query: {
            type: 'string',
            description: 'Natural-language description of the element, e.g. "the login button".',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'ad_press',
      description: 'Tap / press a UI element. Accepts a snapshot ref (@e1), label, or coordinates.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          target: {
            type: 'string',
            description:
              'Element ref (@e1), selector (label="Sign In"), or x,y coordinates.',
          },
          double_tap: { type: 'boolean', description: 'Perform a double tap.' },
          count: { type: 'number', description: 'Number of taps.' },
        },
        required: ['target'],
      },
    },
    {
      name: 'ad_longpress',
      description: 'Long-press a UI element.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          target: { type: 'string', description: 'Element ref, selector, or x,y coordinates.' },
          hold: { type: 'number', description: 'Hold duration in milliseconds (default: 800).' },
        },
        required: ['target'],
      },
    },
    {
      name: 'ad_fill',
      description: 'Focus a text field and fill it with a value.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          target: { type: 'string', description: 'Element ref or selector.' },
          value: { type: 'string', description: 'Text to fill.' },
        },
        required: ['target', 'value'],
      },
    },
    {
      name: 'ad_type',
      description: 'Type text into the currently focused element.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          text: { type: 'string', description: 'Text to type.' },
        },
        required: ['text'],
      },
    },
    {
      name: 'ad_scroll',
      description: 'Scroll within a container.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          target: { type: 'string', description: 'Container element ref or selector (optional).' },
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction.',
          },
          distance: { type: 'number', description: 'Scroll distance in points.' },
        },
        required: ['direction'],
      },
    },
    {
      name: 'ad_scroll_into_view',
      description: 'Scroll until a target element is visible.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          target: { type: 'string', description: 'Element ref or selector to scroll into view.' },
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction.',
          },
        },
        required: ['target'],
      },
    },
    {
      name: 'ad_get',
      description: 'Get a property of a UI element (e.g. label, value, enabled).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          target: { type: 'string', description: 'Element ref or selector.' },
          property: {
            type: 'string',
            description: 'Property name: label, value, enabled, focused, selected, etc.',
          },
        },
        required: ['target', 'property'],
      },
    },
    {
      name: 'ad_is',
      description: 'Assert / check a predicate on the current screen (returns true/false).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          predicate: {
            type: 'string',
            description: 'Predicate string, e.g. "visible label=\\"Login\\"" or "alert present".',
          },
        },
        required: ['predicate'],
      },
    },
    {
      name: 'ad_wait',
      description: 'Wait until a predicate becomes true (polls until timeout).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          predicate: { type: 'string', description: 'Predicate to wait for.' },
          timeout: { type: 'number', description: 'Timeout in milliseconds.' },
        },
        required: ['predicate'],
      },
    },
    {
      name: 'ad_logs',
      description: 'Manage app logs: start, stop, read, clear, or mark.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          action: {
            type: 'string',
            enum: ['start', 'stop', 'path', 'clear', 'mark'],
            description: 'Log action.',
          },
          label: { type: 'string', description: 'Mark label (for action=mark).' },
        },
        required: ['action'],
      },
    },
    {
      name: 'ad_record',
      description: 'Control screen recording: start or stop.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          action: { type: 'string', enum: ['start', 'stop'], description: 'Record action.' },
          out: { type: 'string', description: 'Output file path (for action=start, optional).' },
        },
        required: ['action'],
      },
    },
    {
      name: 'ad_settings',
      description: 'Change device settings: wifi, airplane, location, appearance, permissions, biometric.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          setting: {
            type: 'string',
            description:
              'Setting to change, e.g. "wifi on", "airplane off", "appearance dark", "location always".',
          },
        },
        required: ['setting'],
      },
    },
    {
      name: 'ad_batch',
      description:
        'Execute multiple agent-device commands atomically in a single call. Provide a JSON array of command steps.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          session: { type: 'string', description: 'Session name.' },
          steps: {
            type: 'array',
            description:
              'Array of command steps. Each step: { command: string, positionals?: string[], flags?: object }',
            items: { type: 'object' },
          },
        },
        required: ['steps'],
      },
    },
    {
      name: 'ad_boot',
      description: 'Boot a simulator/emulator without opening an app.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          device: { type: 'string', description: 'Device ID or name.' },
          platform: { type: 'string', enum: ['ios', 'android'], description: 'Platform.' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, unknown>;

  switch (name) {
    case 'ad_devices': {
      const extraArgs = a['platform'] ? ['--platform', String(a['platform'])] : [];
      const r = runAd(['devices', ...extraArgs]);
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_open': {
      const positionals = [String(a['bundle_id'])];
      const r = runAd(['open', ...positionals], {
        session: a['session'] ? String(a['session']) : undefined,
        device: a['device'] ? String(a['device']) : undefined,
        platform: a['platform'] ? String(a['platform']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_close': {
      const r = runAd(['close'], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_session_list': {
      const r = runAd(['session', 'list']);
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_apps': {
      const r = runAd(['apps'], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_snapshot': {
      const extra: string[] = [];
      if (a['mask']) extra.push('--mask');
      const r = runAd(['snapshot', ...extra], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_screenshot': {
      const positionals = a['out'] ? [String(a['out'])] : [];
      const r = runAd(['screenshot', ...positionals], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_find': {
      const r = runAd(['find', String(a['query'])], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_press': {
      const extra: string[] = [];
      if (a['double_tap']) extra.push('--double-tap');
      if (a['count']) extra.push('--count', String(a['count']));
      const r = runAd(['press', String(a['target']), ...extra], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_longpress': {
      const extra: string[] = [];
      if (a['hold']) extra.push('--hold', String(a['hold']));
      const r = runAd(['longpress', String(a['target']), ...extra], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_fill': {
      const r = runAd(['fill', String(a['target']), String(a['value'])], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_type': {
      const r = runAd(['type', String(a['text'])], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_scroll': {
      const positionals = a['target'] ? [String(a['target'])] : [];
      const extra: string[] = ['--direction', String(a['direction'])];
      if (a['distance']) extra.push('--distance', String(a['distance']));
      const r = runAd(['scroll', ...positionals, ...extra], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_scroll_into_view': {
      const extra: string[] = [];
      if (a['direction']) extra.push('--direction', String(a['direction']));
      const r = runAd(['scrollintoview', String(a['target']), ...extra], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_get': {
      const r = runAd(['get', String(a['target']), String(a['property'])], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_is': {
      const r = runAd(['is', String(a['predicate'])], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_wait': {
      const extra: string[] = [];
      if (a['timeout']) extra.push('--timeout', String(a['timeout']));
      const r = runAd(['wait', String(a['predicate']), ...extra], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_logs': {
      const positionals = [String(a['action'])];
      if (a['action'] === 'mark' && a['label']) positionals.push(String(a['label']));
      const r = runAd(['logs', ...positionals], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_record': {
      const positionals = [String(a['action'])];
      if (a['action'] === 'start' && a['out']) positionals.push(String(a['out']));
      const r = runAd(['record', ...positionals], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_settings': {
      const settingParts = String(a['setting']).split(/\s+/);
      const r = runAd(['settings', ...settingParts], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_batch': {
      const steps = JSON.stringify(a['steps']);
      const r = runAd(['batch', steps], {
        session: a['session'] ? String(a['session']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    case 'ad_boot': {
      const extra: string[] = [];
      if (a['platform']) extra.push('--platform', String(a['platform']));
      const r = runAd(['boot', ...extra], {
        device: a['device'] ? String(a['device']) : undefined,
      });
      return r.success ? ok(r.data) : err(r.error);
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
