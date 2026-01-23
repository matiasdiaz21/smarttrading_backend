import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { NOWPaymentsService } from '../services/nowpayments.service';

export class NOWPaymentsController {
  static async getPayments(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        limit,
        page,
        sortBy,
        orderBy,
        dateFrom,
        dateTo,
        invoiceId,
      } = req.query;

      const service = new NOWPaymentsService();
      
      const params: any = {};
      if (limit) params.limit = parseInt(limit as string);
      if (page !== undefined) params.page = parseInt(page as string);
      if (sortBy) params.sortBy = sortBy as string;
      if (orderBy) params.orderBy = orderBy as 'asc' | 'desc';
      if (dateFrom) params.dateFrom = dateFrom as string;
      if (dateTo) params.dateTo = dateTo as string;
      if (invoiceId) params.invoiceId = invoiceId as string;

      const payments = await service.getPayments(params);

      res.json(payments);
    } catch (error: any) {
      console.error('Error getting NOWPayments payments:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error al obtener los pagos de NOWPayments',
      });
    }
  }

  static async getCurrencies(req: AuthRequest, res: Response): Promise<void> {
    try {
      const service = new NOWPaymentsService();
      const currencies = await service.getCurrencies();

      res.json(currencies);
    } catch (error: any) {
      console.error('Error getting NOWPayments currencies:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error al obtener las currencies de NOWPayments',
      });
    }
  }
}


