import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AiConfigModel } from '../models/AiConfig';
import { AiAssetModel } from '../models/AiAsset';
import { AiPredictionModel } from '../models/AiPrediction';
import { GroqModel } from '../models/GroqModel';
import { runFullAnalysis, checkPredictionResults } from '../services/ai.service';

export class AiController {
  // ===================== User endpoints =====================

  /** GET /api/ai/predictions - List predictions */
  static async getPredictions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { symbol, status, timeframe, limit, offset } = req.query;
      const predictions = await AiPredictionModel.findAll({
        symbol: symbol as string,
        status: status as string,
        timeframe: timeframe as string,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      });
      res.json(predictions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/ai/predictions/:id - Prediction detail */
  static async getPredictionById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const prediction = await AiPredictionModel.findById(id);
      if (!prediction) {
        res.status(404).json({ error: 'Predicción no encontrada' });
        return;
      }
      res.json(prediction);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/ai/stats - Global AI stats */
  static async getStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { symbol } = req.query;
      const [stats, byAsset] = await Promise.all([
        AiPredictionModel.getStats(symbol as string),
        AiPredictionModel.getStatsByAsset(),
      ]);
      res.json({ ...stats, by_asset: byAsset });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/ai/assets - List enabled assets (for users) */
  static async getAssets(req: AuthRequest, res: Response): Promise<void> {
    try {
      const assets = await AiAssetModel.findAll(true);
      res.json(assets);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/ai/config/public - Public config (is_enabled, model, etc.) */
  static async getPublicConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      const config = await AiConfigModel.getPublic();
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // ===================== Admin endpoints =====================

  /** GET /api/admin/ai/config - Full AI config */
  static async getConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      const config = await AiConfigModel.get();
      // Mask API key for security
      const maskedConfig = {
        ...config,
        groq_api_key: config.groq_api_key
          ? config.groq_api_key.substring(0, 8) + '...' + config.groq_api_key.substring(config.groq_api_key.length - 4)
          : null,
        has_api_key: !!config.groq_api_key,
      };
      res.json(maskedConfig);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** PUT /api/admin/ai/config - Update AI config */
  static async updateConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        groq_api_key,
        groq_model,
        system_prompt,
        analysis_prompt_template,
        is_enabled,
        auto_run_enabled,
        auto_run_interval_hours,
        max_predictions_per_run,
        default_expiry_hours,
      } = req.body;

      const updateData: any = {};
      if (groq_api_key !== undefined) updateData.groq_api_key = groq_api_key;
      if (groq_model !== undefined) updateData.groq_model = groq_model;
      if (system_prompt !== undefined) updateData.system_prompt = system_prompt;
      if (analysis_prompt_template !== undefined) updateData.analysis_prompt_template = analysis_prompt_template;
      if (is_enabled !== undefined) updateData.is_enabled = !!is_enabled;
      if (auto_run_enabled !== undefined) updateData.auto_run_enabled = !!auto_run_enabled;
      if (auto_run_interval_hours !== undefined) updateData.auto_run_interval_hours = parseInt(auto_run_interval_hours);
      if (max_predictions_per_run !== undefined) updateData.max_predictions_per_run = parseInt(max_predictions_per_run);
      if (default_expiry_hours !== undefined) updateData.default_expiry_hours = parseInt(default_expiry_hours);

      const config = await AiConfigModel.update(updateData);

      // Mask API key in response
      const maskedConfig = {
        ...config,
        groq_api_key: config.groq_api_key
          ? config.groq_api_key.substring(0, 8) + '...' + config.groq_api_key.substring(config.groq_api_key.length - 4)
          : null,
        has_api_key: !!config.groq_api_key,
      };
      res.json(maskedConfig);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** POST /api/admin/ai/analyze - Trigger manual analysis */
  static async triggerAnalysis(req: AuthRequest, res: Response): Promise<void> {
    try {
      console.log(`[AI Controller] 🚀 Análisis manual disparado por admin (user ${req.user?.userId})`);
      const result = await runFullAnalysis();
      res.json(result);
    } catch (error: any) {
      console.error(`[AI Controller] ❌ Error en análisis:`, error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/admin/ai/groq-models - List Groq models for config dropdown */
  static async getGroqModels(req: AuthRequest, res: Response): Promise<void> {
    try {
      const activeOnly = req.query.active === '1' || req.query.active === 'true';
      const models = await GroqModel.findAll(activeOnly);
      res.json(models);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** GET /api/admin/ai/assets - List all assets (admin, including disabled) */
  static async getAdminAssets(req: AuthRequest, res: Response): Promise<void> {
    try {
      const assets = await AiAssetModel.findAll(false);
      res.json(assets);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** POST /api/admin/ai/assets - Add asset */
  static async addAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { symbol, display_name, product_type, category } = req.body;
      if (!symbol) {
        res.status(400).json({ error: 'Symbol es requerido' });
        return;
      }

      // Validate category if provided
      const validCategories = ['crypto', 'forex', 'commodities'];
      if (category && !validCategories.includes(category)) {
        res.status(400).json({ error: `Categoría inválida. Debe ser: ${validCategories.join(', ')}` });
        return;
      }

      // Check duplicate
      const existing = await AiAssetModel.findBySymbol(symbol);
      if (existing) {
        res.status(409).json({ error: `El activo ${symbol.toUpperCase()} ya existe` });
        return;
      }

      const id = await AiAssetModel.create(
        symbol,
        display_name || null,
        req.user?.userId || null,
        product_type || 'USDT-FUTURES',
        category || 'crypto'
      );
      const asset = await AiAssetModel.findById(id);
      res.status(201).json(asset);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** PUT /api/admin/ai/assets/:id - Update asset */
  static async updateAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { symbol, display_name, is_enabled, product_type, category } = req.body;

      const asset = await AiAssetModel.findById(id);
      if (!asset) {
        res.status(404).json({ error: 'Activo no encontrado' });
        return;
      }

      const validCategories = ['crypto', 'forex', 'commodities'];
      if (category !== undefined && !validCategories.includes(category)) {
        res.status(400).json({ error: `Categoría inválida. Debe ser: ${validCategories.join(', ')}` });
        return;
      }

      if (symbol !== undefined && symbol.trim() !== asset.symbol) {
        const existing = await AiAssetModel.findBySymbol(symbol.trim());
        if (existing && existing.id !== id) {
          res.status(409).json({ error: `El símbolo ${symbol.toUpperCase()} ya existe en otro activo` });
          return;
        }
      }

      await AiAssetModel.update(id, {
        symbol: symbol !== undefined ? symbol.trim().toUpperCase() : undefined,
        display_name: display_name !== undefined ? (display_name.trim() || null) : undefined,
        is_enabled: is_enabled !== undefined ? !!is_enabled : undefined,
        product_type: product_type !== undefined ? product_type : undefined,
        category: category !== undefined ? category : undefined,
      });
      const updated = await AiAssetModel.findById(id);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** PUT /api/admin/ai/assets/:id/toggle - Toggle asset */
  static async toggleAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      await AiAssetModel.toggle(id);
      const asset = await AiAssetModel.findById(id);
      res.json(asset);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** DELETE /api/admin/ai/assets/:id - Delete asset */
  static async deleteAsset(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      await AiAssetModel.delete(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** DELETE /api/admin/ai/predictions/:id - Delete prediction */
  static async deletePrediction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const deleted = await AiPredictionModel.deleteById(id);
      if (!deleted) {
        res.status(404).json({ error: 'Predicción no encontrada' });
        return;
      }
      res.json({ message: 'Predicción eliminada' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** PUT /api/admin/ai/predictions/:id/resolve - Manually resolve prediction */
  static async resolvePrediction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id);
      const { status, result_price } = req.body;

      if (!['won', 'lost', 'expired', 'cancelled'].includes(status)) {
        res.status(400).json({ error: 'Status inválido. Debe ser: won, lost, expired o cancelled' });
        return;
      }

      const prediction = await AiPredictionModel.findById(id);
      if (!prediction) {
        res.status(404).json({ error: 'Predicción no encontrada' });
        return;
      }

      let pnlPercent: number | undefined;
      if (result_price && (status === 'won' || status === 'lost')) {
        if (prediction.side === 'LONG') {
          pnlPercent = ((result_price - prediction.entry_price) / prediction.entry_price) * 100;
        } else {
          pnlPercent = ((prediction.entry_price - result_price) / prediction.entry_price) * 100;
        }
        pnlPercent = Math.round(pnlPercent * 100) / 100;
      }

      await AiPredictionModel.updateStatus(id, status, 'admin', result_price, pnlPercent);
      const updated = await AiPredictionModel.findById(id);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** POST /api/admin/ai/check-results - Force check prediction results */
  static async forceCheckResults(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await checkPredictionResults();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
