'use strict';

const esm = require('./esm-bridge');

/**
 * Build a Profile-compatible plain object from flat birth-data input.
 * The shape matches what AstrologyService._normalizeSubject (via Profile.fromJSON)
 * expects: nameZh, gender, and a birthData block with a nested location.
 */
function _makeProfile(name, input) {
  return {
    nameZh: name,
    gender: 'other',
    birthData: {
      year: input.year,
      month: input.month,
      day: input.day,
      hour: input.hour,
      minute: input.minute,
      location: {
        label: `${input.latitude},${input.longitude}`,
        latitude: input.latitude,
        longitude: input.longitude,
      },
    },
  };
}

/**
 * Serialize a ChartData DTO into a compact text representation suitable for
 * inclusion in an LLM prompt. Delegates to ChartSerializer when available;
 * falls back to truncated JSON otherwise.
 */
function _serializeChart(chart) {
  try {
    const { toText } = require('./prompts/ChartSerializer');
    return toText(chart);
  } catch (_) {
    // Fallback if ChartSerializer is not available at runtime
    return JSON.stringify(chart, null, 2).slice(0, 4000);
  }
}

/**
 * Create an array of LangChain DynamicStructuredTool instances that wrap the
 * core astrology engine services. These tools are designed for use inside a
 * ReAct agent loop: each tool accepts flat numeric/string inputs (no nested
 * objects), performs the computation, and returns a string result.
 *
 * @param {import('../astrology/AstrologyService')} astrologyService
 * @param {import('../chinese/ChineseAstrologyService')} chineseAstrologyService
 * @param {import('./AiService')} aiService
 * @returns {Promise<import('@langchain/core/tools').DynamicStructuredTool[]>}
 */
async function createTools(astrologyService, chineseAstrologyService, aiService) {
  const { DynamicStructuredTool } = await esm.load('@langchain/core/tools');
  const z = require('zod');

  // Shared sub-schema: the six birth-data fields every tool needs.
  const birthSchema = {
    year: z.number().int().describe('出生年份，如 1990'),
    month: z.number().int().min(1).max(12).describe('出生月份 1-12'),
    day: z.number().int().min(1).max(31).describe('出生日期 1-31'),
    hour: z.number().int().min(0).max(23).describe('出生小时 0-23'),
    minute: z.number().int().min(0).max(59).describe('出生分钟 0-59'),
    latitude: z.number().min(-90).max(90).describe('出生地纬度'),
    longitude: z.number().min(-180).max(180).describe('出生地经度'),
  };

  // ── Tool 1: Natal chart ────────────────────────────────────────────────
  const computeNatalChart = new DynamicStructuredTool({
    name: 'compute_natal_chart',
    description:
      '计算某人的本命星盘。输入出生年月日时分和出生地经纬度，返回完整的行星位置、宫位、相位数据。',
    schema: z.object(birthSchema),
    func: async (input) => {
      try {
        const profile = _makeProfile('查询对象', input);
        const chart = astrologyService.computeChart({
          type: 'natal',
          primary: profile,
        });
        return _serializeChart(chart);
      } catch (e) {
        return `计算失败: ${e.message}`;
      }
    },
  });

  // ── Tool 2: Transit chart ──────────────────────────────────────────────
  const computeTransit = new DynamicStructuredTool({
    name: 'compute_transit',
    description:
      '计算某人在指定日期的行运盘，分析天象对本命盘的影响。需要出生数据和目标日期。',
    schema: z.object({
      ...birthSchema,
      targetYear: z.number().int().describe('目标年份'),
      targetMonth: z.number().int().min(1).max(12).describe('目标月份'),
      targetDay: z.number().int().min(1).max(31).describe('目标日期'),
    }),
    func: async (input) => {
      try {
        const profile = _makeProfile('查询对象', input);
        const targetDate = new Date(
          Date.UTC(input.targetYear, input.targetMonth - 1, input.targetDay, 12),
        ).toISOString();
        const chart = astrologyService.computeChart({
          type: 'transit',
          primary: profile,
          options: { targetDate },
        });
        return _serializeChart(chart);
      } catch (e) {
        return `计算失败: ${e.message}`;
      }
    },
  });

  // ── Tool 3: Synastry (comparison) chart ────────────────────────────────
  const computeSynastry = new DynamicStructuredTool({
    name: 'compute_synastry',
    description:
      '计算两人之间的合盘（比较盘），分析两人的关系相容性。需要两人的出生数据。',
    schema: z.object({
      year1: z.number().int().describe('第一人出生年份'),
      month1: z.number().int().min(1).max(12).describe('第一人出生月份'),
      day1: z.number().int().min(1).max(31).describe('第一人出生日期'),
      hour1: z.number().int().min(0).max(23).describe('第一人出生小时'),
      minute1: z.number().int().min(0).max(59).describe('第一人出生分钟'),
      latitude1: z.number().min(-90).max(90).describe('第一人出生地纬度'),
      longitude1: z.number().min(-180).max(180).describe('第一人出生地经度'),
      year2: z.number().int().describe('第二人出生年份'),
      month2: z.number().int().min(1).max(12).describe('第二人出生月份'),
      day2: z.number().int().min(1).max(31).describe('第二人出生日期'),
      hour2: z.number().int().min(0).max(23).describe('第二人出生小时'),
      minute2: z.number().int().min(0).max(59).describe('第二人出生分钟'),
      latitude2: z.number().min(-90).max(90).describe('第二人出生地纬度'),
      longitude2: z.number().min(-180).max(180).describe('第二人出生地经度'),
    }),
    func: async (input) => {
      try {
        const profileA = _makeProfile('A', {
          year: input.year1,
          month: input.month1,
          day: input.day1,
          hour: input.hour1,
          minute: input.minute1,
          latitude: input.latitude1,
          longitude: input.longitude1,
        });
        const profileB = _makeProfile('B', {
          year: input.year2,
          month: input.month2,
          day: input.day2,
          hour: input.hour2,
          minute: input.minute2,
          latitude: input.latitude2,
          longitude: input.longitude2,
        });
        const chart = astrologyService.computeChart({
          type: 'synastry',
          primary: profileA,
          secondary: profileB,
        });
        return _serializeChart(chart);
      } catch (e) {
        return `计算失败: ${e.message}`;
      }
    },
  });

  // ── Tool 4: BaZi (Four Pillars of Destiny) ────────────────────────────
  const computeBazi = new DynamicStructuredTool({
    name: 'compute_bazi',
    description:
      '计算某人的八字命盘（四柱：年柱、月柱、日柱、时柱），返回天干地支、五行、生肖等信息。',
    schema: z.object(birthSchema),
    func: async (input) => {
      try {
        const result = chineseAstrologyService.computeBaZi({
          birthData: {
            year: input.year,
            month: input.month,
            day: input.day,
            hour: input.hour,
            minute: input.minute,
            location: {
              label: `${input.latitude},${input.longitude}`,
              latitude: input.latitude,
              longitude: input.longitude,
            },
          },
        });
        const p = result.bazi.pillars;
        const dm = result.bazi.dayMaster;
        const lines = [
          `八字四柱: ${p.year.full} ${p.month.full} ${p.day.full} ${p.hour.full}`,
          `日主: ${dm.char} (${dm.element})`,
        ];
        if (result.lunar) {
          lines.push(
            `农历: ${result.lunar.lunarYear || ''} ${result.lunar.lunarMonth || ''}${result.lunar.lunarDay || ''}`,
          );
        }
        return lines.join('\n');
      } catch (e) {
        return `计算失败: ${e.message}`;
      }
    },
  });

  // ── Tool 5: Solar Return chart ──────────────────────────────────────────
  const computeSolarReturn = new DynamicStructuredTool({
    name: 'compute_solar_return',
    description:
      '计算某人的太阳返照盘（Solar Return），分析指定年份的年运主题。需要出生数据和目标年份。',
    schema: z.object({
      ...birthSchema,
      targetYear: z.number().int().describe('返照年份'),
    }),
    func: async (input) => {
      try {
        const profile = _makeProfile('查询对象', input);
        const chart = astrologyService.computeChart({
          type: 'solarReturn',
          primary: profile,
          options: { year: input.targetYear },
        });
        return _serializeChart(chart);
      } catch (e) {
        return `计算失败: ${e.message}`;
      }
    },
  });

  // ── Tool 6: Secondary Progressions chart ───────────────────────────────
  const computeProgressed = new DynamicStructuredTool({
    name: 'compute_progressed',
    description:
      '计算某人的次限推运盘（Secondary Progressions），分析生命历程的内在发展。需要出生数据和目标日期。',
    schema: z.object({
      ...birthSchema,
      targetYear: z.number().int().describe('目标年份'),
      targetMonth: z.number().int().min(1).max(12).describe('目标月份'),
      targetDay: z.number().int().min(1).max(31).describe('目标日期'),
    }),
    func: async (input) => {
      try {
        const profile = _makeProfile('查询对象', input);
        const targetDate = new Date(
          Date.UTC(input.targetYear, input.targetMonth - 1, input.targetDay, 12),
        ).toISOString();
        const chart = astrologyService.computeChart({
          type: 'progressed',
          primary: profile,
          options: { targetDate },
        });
        return _serializeChart(chart);
      } catch (e) {
        return `计算失败: ${e.message}`;
      }
    },
  });

  // ── Tool 7: Get current context (no params) ─────────────────────────────
  const getCurrentContext = new DynamicStructuredTool({
    name: 'get_current_context',
    description:
      '查询用户当前正在查看的页面和选中的档案信息。无需输入参数。返回当前路由、选中档案摘要、最后计算的星盘类型。',
    schema: z.object({}),
    func: async () => {
      const ctx = (aiService && aiService.getContext()) || {};
      const route = ctx.route || '未知';
      const profile = ctx.activeProfile;
      const chartType = ctx.chartType || '无';
      const lines = [`当前页面: ${route}`];
      if (profile) {
        lines.push(`选中档案: ${profile.nameZh || profile.nameEn || '未命名'}`);
      }
      lines.push(`最后计算: ${chartType}`);
      return lines.join('\n');
    },
  });

  // ── Tool 8: Get current chart data (no params) ─────────────────────────
  const getCurrentChart = new DynamicStructuredTool({
    name: 'get_current_chart',
    description:
      '获取用户当前打开的星盘完整数据（行星位置、宫位、相位等）。无需输入参数。如果用户尚未计算任何星盘，返回提示。',
    schema: z.object({}),
    func: async () => {
      const ctx = (aiService && aiService.getContext()) || {};
      if (!ctx.lastChartData) return '用户尚未计算任何星盘。';
      return _serializeChart(ctx.lastChartData);
    },
  });

  // ── Tool 9: Get active profile (no params) ─────────────────────────────
  const getActiveProfile = new DynamicStructuredTool({
    name: 'get_active_profile',
    description:
      '获取当前选中档案的出生信息（姓名、出生日期时间、出生地经纬度）。无需输入参数。',
    schema: z.object({}),
    func: async () => {
      const ctx = (aiService && aiService.getContext()) || {};
      const p = ctx.activeProfile;
      if (!p) return '当前没有选中的档案。';
      const b = p.birthData || {};
      const loc = b.location || {};
      return `${p.nameZh || p.nameEn || '未命名'}，${b.year}年${b.month}月${b.day}日 ${b.hour}:${String(b.minute).padStart(2,'0')}，${loc.label || ''}（${loc.latitude}°N, ${loc.longitude}°E）`;
    },
  });

  return [
    computeNatalChart,
    computeTransit,
    computeSynastry,
    computeBazi,
    computeSolarReturn,
    computeProgressed,
    getCurrentContext,
    getCurrentChart,
    getActiveProfile,
  ];
}

module.exports = { createTools };
