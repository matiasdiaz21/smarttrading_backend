-- Migración: Agregar campo nowpayments_invoice_id a payment_plans
-- Este campo almacena el invoice_id de NOWPayments que se usará para el widget de pago

USE smarttrading;

ALTER TABLE payment_plans 
ADD COLUMN nowpayments_invoice_id VARCHAR(255) NULL AFTER features,
ADD INDEX idx_nowpayments_invoice_id (nowpayments_invoice_id);


