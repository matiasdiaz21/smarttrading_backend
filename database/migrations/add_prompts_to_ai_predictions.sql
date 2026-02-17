-- Add columns to store the full prompts used for each prediction
ALTER TABLE ai_predictions
  ADD COLUMN system_prompt_used TEXT DEFAULT NULL COMMENT 'System prompt enviado a Groq' AFTER raw_ai_response,
  ADD COLUMN user_prompt_used TEXT DEFAULT NULL COMMENT 'User prompt completo enviado a Groq' AFTER system_prompt_used;
