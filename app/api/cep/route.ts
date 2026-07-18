import { requireUser } from "../../../lib/auth";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const cep = new URL(request.url).searchParams.get("cep")?.replace(/\D/g, "") || "";
  if (cep.length !== 8) return Response.json({ error: "Informe um CEP válido." }, { status: 400 });
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (!response.ok || data.erro) return Response.json({ error: "CEP não encontrado." }, { status: 404 });
    return Response.json({ street: data.logradouro || "", neighborhood: data.bairro || "", city: data.localidade || "", state: data.uf || "" });
  } catch {
    return Response.json({ error: "Não foi possível consultar o CEP agora." }, { status: 502 });
  }
}
