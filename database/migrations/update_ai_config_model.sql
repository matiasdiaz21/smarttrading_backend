-- Fix decommissioned Groq model and clear old prompt templates so auto-prompt takes over
UPDATE ai_config 
SET groq_model = 'llama-3.3-70b-versatile',
    system_prompt = NULL,
    analysis_prompt_template = NULL
WHERE id = 1;
