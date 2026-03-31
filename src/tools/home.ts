import { z } from 'zod';
import { Config } from '../config.js';

async function haRequest(config: Config, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
  if (!config.haToken) throw new Error('HA_TOKEN not configured');
  const res = await fetch(`${config.haUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.haToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HA API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// --- Schemas (exported so index.ts can use them directly) ---

export const getStateSchema = {
  entity_id: z.string().describe('Entity ID, e.g. light.wohnzimmer or climate.wohnzimmer'),
};

export const lightSchema = {
  entity_id: z.string().describe('Light entity ID, e.g. light.wohnzimmer'),
  action: z.enum(['on', 'off', 'toggle']),
  brightness_pct: z.number().min(0).max(100).optional().describe('Brightness in percent (0-100)'),
  color_temp_kelvin: z.number().optional().describe('Color temperature in Kelvin (2000-6500)'),
  rgb_color: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB color as [r, g, b]'),
};

export const climateSchema = {
  entity_id: z.string().describe('Climate entity, e.g. climate.wohnzimmer'),
  temperature: z.number().min(5).max(30).optional().describe('Target temperature in °C'),
  hvac_mode: z.enum(['heat', 'auto', 'off']).optional().describe('HVAC mode'),
};

export const sceneSchema = {
  room: z.enum(['wohnzimmer', 'flur', 'kuche', 'schlafzimmer', 'home']).describe('Room name'),
  scene: z.string().describe('Scene name, e.g. entspannen, konzentrieren, lesen, nachtlicht, hell, gedimmt'),
};

export const vacuumSchema = {
  action: z.enum(['start', 'stop', 'return_to_base', 'status']),
};

export const sensorsSchema = {};

// --- Handlers ---

export async function handleGetState(args: { entity_id: string }, config: Config) {
  const state = await haRequest(config, 'GET', `/api/states/${args.entity_id}`);
  return {
    entity_id: state['entity_id'],
    state: state['state'],
    attributes: state['attributes'],
    last_changed: state['last_changed'],
  };
}

export async function handleLight(args: {
  entity_id: string;
  action: 'on' | 'off' | 'toggle';
  brightness_pct?: number;
  color_temp_kelvin?: number;
  rgb_color?: [number, number, number];
}, config: Config) {
  const service = args.action === 'toggle' ? 'toggle' : `turn_${args.action}`;
  const data: Record<string, unknown> = { entity_id: args.entity_id };
  if (args.action === 'on') {
    if (args.brightness_pct !== undefined) data['brightness_pct'] = args.brightness_pct;
    if (args.color_temp_kelvin !== undefined) data['color_temp_kelvin'] = args.color_temp_kelvin;
    if (args.rgb_color !== undefined) data['rgb_color'] = args.rgb_color;
  }
  await haRequest(config, 'POST', `/api/services/light/${service}`, data);
  return { success: true, entity_id: args.entity_id, action: args.action };
}

export async function handleClimate(args: {
  entity_id: string;
  temperature?: number;
  hvac_mode?: 'heat' | 'auto' | 'off';
}, config: Config) {
  if (args.temperature !== undefined) {
    await haRequest(config, 'POST', '/api/services/climate/set_temperature', {
      entity_id: args.entity_id,
      temperature: args.temperature,
    });
  }
  if (args.hvac_mode !== undefined) {
    await haRequest(config, 'POST', '/api/services/climate/set_hvac_mode', {
      entity_id: args.entity_id,
      hvac_mode: args.hvac_mode,
    });
  }
  return { success: true, entity_id: args.entity_id };
}

export async function handleScene(args: { room: string; scene: string }, config: Config) {
  const sceneId = `scene.${args.room}_${args.scene}`;
  await haRequest(config, 'POST', '/api/services/scene/turn_on', { entity_id: sceneId });
  return { success: true, scene: sceneId };
}

export async function handleVacuum(args: { action: string }, config: Config) {
  if (args.action === 'status') {
    const state = await haRequest(config, 'GET', '/api/states/vacuum.roborock_qv_35s');
    return { state: state['state'], attributes: state['attributes'] };
  }
  if (args.action === 'start') {
    await haRequest(config, 'POST', '/api/services/button/press', {
      entity_id: 'button.roborock_qv_35s_saugen_komplett',
    });
  } else if (args.action === 'stop') {
    await haRequest(config, 'POST', '/api/services/vacuum/stop', {
      entity_id: 'vacuum.roborock_qv_35s',
    });
  } else if (args.action === 'return_to_base') {
    await haRequest(config, 'POST', '/api/services/vacuum/return_to_base', {
      entity_id: 'vacuum.roborock_qv_35s',
    });
  }
  return { success: true, action: args.action };
}

export async function handleSensors(_args: Record<string, never>, config: Config) {
  const sensorIds = [
    'sensor.wohnzimmer_temperatur',
    'sensor.wohnzimmer_luftfeuchtigkeit',
    'sensor.kuche_temperatur',
    'sensor.kuche_luftfeuchtigkeit',
    'sensor.badezimmer_temperatur',
    'sensor.badezimmer_luftfeuchtigkeit',
    'sensor.indoormodul_co2',
    'sensor.emre_kohler_aussentemperatur',
  ];
  const results: Record<string, string> = {};
  await Promise.all(
    sensorIds.map(async (id) => {
      try {
        const s = await haRequest(config, 'GET', `/api/states/${id}`);
        const attrs = s['attributes'] as Record<string, unknown> | undefined;
        const unit = attrs?.['unit_of_measurement'] ?? '';
        results[id] = `${s['state']} ${unit}`.trim();
      } catch {
        results[id] = 'unavailable';
      }
    })
  );
  return results;
}
