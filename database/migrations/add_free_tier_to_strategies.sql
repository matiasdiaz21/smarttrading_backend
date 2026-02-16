-- Estrategias gratuitas o de pago; si es gratuita, hasta cuándo (NULL = indefinido)
ALTER TABLE strategies
  ADD COLUMN is_free BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN free_until DATE NULL;
