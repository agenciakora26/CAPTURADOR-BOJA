const { createClient } = require('@supabase/supabase-js');

console.log("--- COMPROBANDO CREDENCIALES ---");
console.log("SUPABASE_URL existe:", !!process.env.SUPABASE_URL);
console.log("SUPABASE_KEY existe:", !!process.env.SUPABASE_KEY);
console.log("RESEND_API_KEY existe:", !!process.env.RESEND_API_KEY);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR CRÍTICO: Una de las variables de Supabase está vacía en el entorno de GitHub.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("¡Cliente de Supabase inicializado correctamente!");
