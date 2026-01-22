import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';

export interface CreatePaymentRequest {
  price_amount: number;
  price_currency: string;
  pay_currency?: string;
  order_id?: string;
  order_description?: string;
  ipn_callback_url?: string;
  success_url?: string;
  cancel_url?: string;
}

export interface PaymentResponse {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id: string;
  order_description: string;
  ipn_callback_url: string;
  created_at: string;
  updated_at: string;
}

export class NOWPaymentsService {
  private apiKey: string;
  private apiUrl: string;
  private webhookSecret: string;

  constructor() {
    this.apiKey = config.nowpayments.apiKey;
    this.apiUrl = config.nowpayments.apiUrl;
    this.webhookSecret = config.nowpayments.webhookSecret;
  }

  private getHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  async createPayment(data: CreatePaymentRequest): Promise<PaymentResponse> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/payment`,
        data,
        { headers: this.getHeaders() }
      );

      return response.data;
    } catch (error: any) {
      throw new Error(
        `NOWPayments API Error: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentResponse> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/payment/${paymentId}`,
        { headers: this.getHeaders() }
      );

      return response.data;
    } catch (error: any) {
      throw new Error(
        `Failed to get payment status: ${error.response?.data?.message || error.message}`
      );
    }
  }

  verifyWebhookSignature(
    payload: string,
    signature: string
  ): boolean {
    const expectedSignature = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}

