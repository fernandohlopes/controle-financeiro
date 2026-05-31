export default function handler(req, res) {
  // Permite apenas GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Retorna as chaves das variáveis de ambiente — nunca expostas no frontend
  res.status(200).json({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
  });
}
