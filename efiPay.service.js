const EfiPaySdk = require('sdk-node-apis-efi');
require('dotenv').config();
const fs = require('fs');

/**
 * Inicializa e configura o SDK da Efí Pay.
 * A configuração é montada dinamicamente com base nas variáveis de ambiente.
 */
const initializeEfiPay = () => {
  const isProduction = process.env.NODE_ENV === 'production';

  // Validação robusta das credenciais com base no ambiente
  if (isProduction) {
    if (!process.env.EFI_PROD_CLIENT_ID || !process.env.EFI_PROD_CLIENT_SECRET) {
      throw new Error('Credenciais de PRODUÇÃO da Efí (EFI_PROD_CLIENT_ID, EFI_PROD_CLIENT_SECRET) não estão definidas no ambiente.');
    }
  } else {
    if (!process.env.EFI_HOMOLOG_CLIENT_ID || !process.env.EFI_HOMOLOG_CLIENT_SECRET) {
      throw new Error('Credenciais de HOMOLOGAÇÃO da Efí (EFI_HOMOLOG_CLIENT_ID, EFI_HOMOLOG_CLIENT_SECRET) não estão definidas no ambiente.');
    }
  }

  // Valida a existência da chave PIX, que é necessária para criar cobranças.
  if (!process.env.EFI_PIX_KEY) {
    throw new Error('A variável de ambiente EFI_PIX_KEY não está definida.');
  }

  let certificateContent;
  const certPath = process.env.EFI_CERTIFICATE_PATH;
  const certBase64 = process.env.EFI_CERTIFICATE_BASE64;

  if (certPath) {
    // Prioridade 1: Usar o caminho do arquivo. Ideal para Render Secret Files.
    console.log(`[Efí Pay Service] Lendo certificado do caminho: ${certPath}`);
    if (!fs.existsSync(certPath)) {
      throw new Error(`Arquivo de certificado não encontrado no caminho especificado em EFI_CERTIFICATE_PATH: ${certPath}`);
    }
    try {
      certificateContent = fs.readFileSync(certPath);
    } catch (error) {
      throw new Error(`Falha ao ler o arquivo de certificado em ${certPath}. Verifique as permissões.`);
    }
  } else if (certBase64) {
    // Prioridade 2: Usar o conteúdo Base64 da variável de ambiente.
    console.log('[Efí Pay Service] Usando conteúdo do certificado da variável EFI_CERTIFICATE_BASE64.');
    certificateContent = Buffer.from(certBase64, 'base64');
  } else {
    // Se nenhuma das duas for fornecida, o erro é lançado.
    throw new Error('Nenhuma configuração de certificado encontrada. Defina EFI_CERTIFICATE_PATH ou EFI_CERTIFICATE_BASE64.');
  }

  const options = {
    client_id: isProduction ? process.env.EFI_PROD_CLIENT_ID : process.env.EFI_HOMOLOG_CLIENT_ID,
    client_secret: isProduction ? process.env.EFI_PROD_CLIENT_SECRET : process.env.EFI_HOMOLOG_CLIENT_SECRET,
    sandbox: !isProduction,
    // O SDK espera o conteúdo do arquivo .p12 como um Buffer, não como uma string Base64.
    certificate: certificateContent,
  };
  
  try {
    // Log para depuração, confirmando as opções usadas para inicializar o SDK
    console.log(`[Efí Pay Service] Inicializando SDK em modo ${options.sandbox ? 'Sandbox' : 'Produção'}. Client ID: ${options.client_id ? 'Definido' : '***NÃO DEFINIDO***'}`);
    // Retorna uma nova instância do SDK já configurada
    return new EfiPaySdk(options);
  } catch (e) {
    console.error('[Efí Pay Service] ERRO CRÍTICO ao instanciar o SDK da Efí:', e);
    throw e; // Lança o erro para interromper a inicialização da aplicação
  }
};

// Padrão Singleton com "Lazy Initialization"
// A instância só será criada na primeira vez que for solicitada.
let efiInstance = null;

const getEfiInstance = () => {
  if (!efiInstance) {
    console.log("[Efí Pay Service] Primeira chamada detectada. Inicializando instância do SDK...");
    efiInstance = initializeEfiPay();
  }
  return efiInstance;
};

const EfiPay = {
  createPixCharge: async (total, expirationInSeconds) => {
    const sdk = getEfiInstance(); // Garante que a instância exista antes de usar

    try {
      // Corpo da requisição para criar a cobrança imediata
      const body = {
        calendario: {
          expiracao: expirationInSeconds.toString(),
        },
        valor: {
          // A API da Efí espera o valor como uma string com duas casas decimais.
          original: total.toFixed(2),
        },
        chave: process.env.EFI_PIX_KEY, // Sua chave PIX cadastrada na Efí
        solicitacaoPagador: `Pedido Gamer Store R$${total.toFixed(2)}`,
      };

      console.log("Enviando requisição para a API da Efí...");

      // Chama o método do SDK para criar a cobrança, usando a instância singleton.
      const pixChargeResponse = await sdk.pixCreateImmediateCharge({}, body); // O primeiro argumento (params) pode ser um objeto vazio.

      // Gera o QR Code para a cobrança criada.
      const qrCodeResponse = await sdk.pixGenerateQRCode({ params: { txid: pixChargeResponse.txid } });

      console.log("Cobrança PIX e QR Code gerados com sucesso!");

      // Retorna um objeto unificado com as informações necessárias para o frontend
      return {
        txid: pixChargeResponse.txid,
        pixCopiaECola: qrCodeResponse.pix_copia_e_cola,
        imagemQrcode: qrCodeResponse.imagem_qrcode,
      };

    } catch (error) {
      // O SDK da Efí pode retornar o erro em diferentes propriedades
      const errorMessage = error.error_description || (error.erros && error.erros[0] && error.erros[0].mensagem) || error.message || 'Falha na comunicação com a API de pagamento.';
      console.error('Erro ao gerar cobrança Efí:', errorMessage, error);
      // Lança um erro mais específico, que pode ser útil para o chamador da função.
      throw new Error(errorMessage);
    }
  },
};

module.exports = { EfiPay, getEfiInstance };