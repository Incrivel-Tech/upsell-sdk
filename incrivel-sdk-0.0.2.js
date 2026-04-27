/**
 * ============================================================================
 * VENDAMAIS UPSELL SDK v0.0.2
 * ============================================================================
 *
 * Descrição: SDK JavaScript para integração de campanhas de upsell em Next.js
 *
 * Características:
 * - Rastreamento de visitantes via fingerprint + session_id
 * - Detecção de clientes logados em tempo real
 * - Carregamento automático de campanhas ativas
 * - Renderização segura de widgets HTML/CSS
 * - Sincronização de eventos (view, click, accept, reject)
 * - Batching inteligente de eventos
 * - Debug mode e error handling robusto
 *
 * Uso:
 * <script
 *   src="https://cdn.vendamais.top/0.0.2/incrivel-sdk.js"
 *   data-base-url="https://seu-tenant.vitor.dev.br/api"
 *   data-api-key="pk_live_xxx"
 *   data-debug="true"
 *   async
 * />
 *
 * ============================================================================
 */

(function(w, d) {
  'use strict';

  // =========================================================================
  // UTILIDADES
  // =========================================================================

  /**
   * Gerador de UUID v4
   */
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Sistema de logging
   */
  const Logger = {
    debug: false,
    log: function(message, data) {
      if (!this.debug) return;
      const style = 'color: #0066cc; font-weight: bold;';
      console.log(`%c[UpsellSDK] ${message}`, style, data || '');
    },
    error: function(message, error) {
      if (!this.debug) return;
      const style = 'color: #cc0000; font-weight: bold;';
      console.error(`%c[UpsellSDK] ${message}`, style, error || '');
    },
    warn: function(message, data) {
      if (!this.debug) return;
      const style = 'color: #ff9900; font-weight: bold;';
      console.warn(`%c[UpsellSDK] ${message}`, style, data || '');
    }
  };

  /**
   * Gerenciamento de Storage
   */
  const StorageManager = {
    setLocal: function(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        Logger.error('Failed to set localStorage', e);
        return false;
      }
    },
    getLocal: function(key) {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch (e) {
        return null;
      }
    },
    removeLocal: function(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (e) {
        return false;
      }
    },
    setSession: function(key, value) {
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    getSession: function(key) {
      try {
        const value = sessionStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch (e) {
        return null;
      }
    }
  };

  /**
   * Requisições HTTP
   */
  const HttpClient = {
    async get(url, options = {}) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          ...options
        });

        if (!response.ok) {
          Logger.error(`HTTP ${response.status}`, url);
          return null;
        }

        return await response.json();
      } catch (error) {
        Logger.error('Network error (GET)', error);
        return null;
      }
    },

    async post(url, data, options = {}) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          body: JSON.stringify(data),
          ...options
        });

        if (!response.ok) {
          Logger.error(`HTTP ${response.status}`, url);
          return null;
        }

        return await response.json();
      } catch (error) {
        Logger.error('Network error (POST)', error);
        return null;
      }
    }
  };

  // =========================================================================
  // CONFIGURAÇÃO DE POSIÇÕES POR PÁGINA
  // =========================================================================

  /**
   * CONFIGURAÇÕES DE LAYOUT
   * Mapeia tipos de página para IDs/classes de containers
   *
   * Customize aqui para diferentes plataformas:
   * - NextJS
   * - React
   * - WooCommerce
   * - Shopify
   * - Custom
   */
  const LayoutConfig = {
    // Mapa de page_type → container_id
    containerMap: {
      'home': '#upsell-widget-home',           // ou '.upsell-container-home'
      'product_page': '#upsell-widget-product',
      'cart_page': '#upsell-widget-cart',
      'pre_checkout': '#upsell-widget-checkout',
      'post_purchase': '#upsell-widget-success',
      'other': '#upsell-widget-root'
    },

    /**
     * Posições alternativas (fallback)
     * Se o container específico não existir, tenta estas
     */
    fallbackContainers: [
      '#upsell-widget-root',
      '.upsell-widget-container',
      '#widget-container'
    ],

    /**
     * Obter container para uma página específica
     * @param {string} pageType - Tipo de página detectado
     * @param {string} overrideContainerId - Override via data-attribute
     * @returns {string} - ID ou classe do container
     */
    getContainerId: function(pageType, overrideContainerId) {
      // 1. Usar override se fornecido (data-container-id)
      if (overrideContainerId) {
        Logger.log('🎯 Usando container override', overrideContainerId);
        return overrideContainerId;
      }

      // 2. Usar mapeamento por tipo de página
      if (this.containerMap[pageType]) {
        Logger.log('🎯 Usando container mapeado', { pageType, containerId: this.containerMap[pageType] });
        return this.containerMap[pageType];
      }

      // 3. Usar fallback padrão
      Logger.log('🎯 Usando container fallback', { pageType });
      return this.containerMap['other'];
    },

    /**
     * Encontrar elemento no DOM
     * Suporta IDs (#) e classes (.)
     */
    findElement: function(selector) {
      if (!selector) return null;

      try {
        if (selector.startsWith('#')) {
          return d.getElementById(selector.substring(1));
        } else if (selector.startsWith('.')) {
          return d.querySelector(selector);
        } else {
          return d.getElementById(selector);
        }
      } catch (e) {
        return null;
      }
    },

    /**
     * Obter ou criar container
     * @param {string} pageType
     * @param {string} overrideContainerId
     * @returns {HTMLElement}
     */
    getOrCreateContainer: function(pageType, overrideContainerId) {
      const containerId = this.getContainerId(pageType, overrideContainerId);
      let container = this.findElement(containerId);

      // Se não encontrou, criar no final do body
      if (!container) {
        Logger.warn('⚠️ Container não encontrado, criando novo', containerId);
        container = d.createElement('div');
        container.id = containerId.replace(/^[#.]/, '');
        d.body.appendChild(container);
      }

      return container;
    }
  };

  // =========================================================================
  // MÓDULOS DO SDK
  // =========================================================================

  /**
   * MÓDULO: Fingerprint
   * Gerencia identidade persistente do visitante
   */
  const FingerprintModule = {
    KEY: 'vm_sdk_visitor_fp',

    getOrCreate: function() {
      let fp = StorageManager.getLocal(this.KEY);

      if (!fp) {
        fp = generateUUID();
        StorageManager.setLocal(this.KEY, fp);
        Logger.log('📍 Novo fingerprint gerado', fp);
      } else {
        Logger.log('📍 Fingerprint recuperado', fp);
      }

      return fp;
    }
  };

  /**
   * MÓDULO: Session
   * Gerencia session_id da sessão atual
   */
  const SessionModule = {
    KEY: 'vm_session_id',

    getOrCreate: function() {
      let sessionId = StorageManager.getSession(this.KEY);

      if (!sessionId) {
        sessionId = generateUUID();
        StorageManager.setSession(this.KEY, sessionId);
        Logger.log('🔑 Session ID criado', sessionId);
      }

      return sessionId;
    }
  };

  /**
   * MÓDULO: PageDetector
   * Detecta tipo de página automaticamente
   */
  const PageDetectorModule = {
    lastPath: '',

    detect: function() {
      const path = w.location.pathname.toLowerCase();

      if (path === '/' || path === '') return 'home';
      if (path.includes('/produto') || path.includes('/product') || path.includes('/item')) return 'product_page';
      if (path.includes('/carrinho') || path.includes('/cart') || path.includes('/bag')) return 'cart_page';
      if (path.includes('/checkout') || path.includes('/compra') || path.includes('/order')) return 'pre_checkout';
      if (path.includes('/sucesso') || path.includes('/confirmacao') || path.includes('/obrigado')) return 'post_purchase';

      return 'other';
    },

    hasChanged: function() {
      const path = w.location.pathname;
      if (path !== this.lastPath) {
        this.lastPath = path;
        return true;
      }
      return false;
    }
  };

  /**
   * MÓDULO: LoginDetector
   * Detecta login do usuário monitorando localStorage
   */
  const LoginDetectorModule = {
    lastCustomerId: null,

    getCustomerId: function() {
      try {
        // Procurar por campo 'id' em localStorage
        // (assume que o cliente tem estrutura como { id: 123, email: '...', ... })
        const userData = localStorage.getItem('user');
        if (!userData) return null;

        // Tentar fazer parse JSON
        try {
          const parsed = JSON.parse(userData);
          if (typeof parsed === 'object' && typeof parsed.id === 'number') {
            return parsed.id;
          }
        } catch (e) {
          // Pode estar criptografado — não tentar descriptografar
        }

        return null;
      } catch (e) {
        return null;
      }
    },

    hasLoggedIn: function() {
      const customerId = this.getCustomerId();

      if (customerId && customerId !== this.lastCustomerId) {
        this.lastCustomerId = customerId;
        Logger.log('👤 Login detectado', { customerId });
        return customerId;
      }

      return null;
    }
  };

  /**
   * MÓDULO: Tracker
   * Rastreia eventos do widget e faz batching
   */
  const TrackerModule = {
    queue: [],
    maxBatchSize: 50,
    batchInterval: 10000, // 10 segundos
    batchTimer: null,

    init: function(offerId, config) {
      this.offerId = offerId;
      this.config = config;
      this.queue = [];

      // Iniciar timer de batch
      this.startBatchTimer();
    },

    track: function(action, metadata = {}) {
      if (!this.offerId) return;

      const event = {
        offer_id: this.offerId,
        action: action,
        visitor_id: this.config.fingerprint,
        session_id: this.config.sessionId,
        metadata: metadata
      };

      this.queue.push(event);
      Logger.log('📊 Evento rastreado', { action, queue_size: this.queue.length });

      // Enviar se atingiu limite
      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
      }
    },

    startBatchTimer: function() {
      if (this.batchTimer) clearInterval(this.batchTimer);

      this.batchTimer = setInterval(() => {
        if (this.queue.length > 0) {
          this.flush();
        }
      }, this.batchInterval);
    },

    flush: async function() {
      if (this.queue.length === 0) return;

      const events = this.queue.splice(0, this.maxBatchSize);
      const url = `${this.config.baseUrl}/v1/widget/track/batch?key=${this.config.apiKey}`;

      Logger.log('📤 Enviando batch de eventos', { count: events.length });

      await HttpClient.post(url, { events });
    },

    destroy: function() {
      if (this.batchTimer) {
        clearInterval(this.batchTimer);
      }
      this.flush();
    }
  };

  /**
   * MÓDULO: Renderer
   * Renderiza widget HTML/CSS com suporte a múltiplas posições
   */
  const RendererModule = {
    render: function(config, offer, campaign, pageType) {
      Logger.log('🎨 Renderizando widget', { pageType });

      // Obter container correto para a página
      const container = LayoutConfig.getOrCreateContainer(pageType, config.containerId);

      if (!container) {
        Logger.error('❌ Não foi possível encontrar ou criar container');
        return;
      }

      // Limpar container anterior
      container.innerHTML = '';

      // Injetar CSS
      if (campaign.widget_css) {
        let styleTag = d.getElementById('vm_sdk_styles');
        if (!styleTag) {
          styleTag = d.createElement('style');
          styleTag.id = 'vm_sdk_styles';
          d.head.appendChild(styleTag);
        }
        styleTag.textContent = campaign.widget_css;
      }

      // Injetar HTML (seguro)
      if (campaign.widget_html) {
        const template = d.createElement('template');
        template.innerHTML = campaign.widget_html;
        container.appendChild(template.content.cloneNode(true));
      }

      // Registrar event listeners
      this.attachEventListeners(offer, config, container);

      Logger.log('✅ Widget renderizado com sucesso', { containerId: container.id });
    },

    attachEventListeners: function(offer, config, container) {
      // Click em botões dentro do container
      const buttons = container.querySelectorAll('[data-upsell-action]');
      buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const action = btn.getAttribute('data-upsell-action');

          if (action === 'accept' || action === 'add_to_cart') {
            TrackerModule.track('accept', { button_text: btn.textContent });
          } else if (action === 'reject') {
            TrackerModule.track('reject');
          }
        });
      });

      // Close button dentro do container
      const closeBtn = container.querySelector('[data-upsell-close]');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          TrackerModule.track('close');
          container.innerHTML = '';
        });
      }
    },

    clear: function(pageType, containerId) {
      const container = containerId
        ? LayoutConfig.findElement(containerId)
        : LayoutConfig.getOrCreateContainer(pageType, containerId);

      if (container) {
        container.innerHTML = '';
        Logger.log('🧹 Widget limpo');
      }
    }
  };

  /**
   * MÓDULO: Campaign
   * Carrega campanhas do backend
   */
  const CampaignModule = {
    async fetch(config, pageType, customerId = null) {
      const url = new URL(`${config.baseUrl}/v1/widget/offer`, w.location.origin);
      url.searchParams.append('key', config.apiKey);
      url.searchParams.append('fingerprint', config.fingerprint);
      url.searchParams.append('location', pageType);

      if (customerId) {
        url.searchParams.append('customer_id', customerId);
      }

      Logger.log('🔍 Carregando campanha', { pageType, customerId });

      const data = await HttpClient.get(url.toString());

      if (data && data.offer_id) {
        Logger.log('✅ Campanha carregada', { offer_id: data.offer_id });
        return data;
      }

      Logger.warn('❌ Nenhuma campanha disponível');
      return null;
    }
  };

  /**
   * MÓDULO: Visitor
   * Sincroniza contexto do visitante
   */
  const VisitorModule = {
    async sync(config, pageType) {
      const url = `${config.baseUrl}/v1/widget/visitor/sync?key=${config.apiKey}`;

      const payload = {
        fingerprint: config.fingerprint,
        session_id: config.sessionId,
        current_page: w.location.pathname
      };

      Logger.log('🔄 Sincronizando visitante', payload);

      await HttpClient.post(url, payload);
    }
  };

  // =========================================================================
  // CLASSE PRINCIPAL: UpsellSDK
  // =========================================================================

  class UpsellSDK {
    constructor(config) {
      this.config = {
        baseUrl: config.baseUrl || '',
        apiKey: config.apiKey || '',
        debug: config.debug === 'true' || config.debug === true,
        containerId: config.containerId || 'upsell-widget-root',
        location: config.location || null
      };

      // Setup logger
      Logger.debug = this.config.debug;

      if (this.config.debug) {
        console.log('%c[UpsellSDK] 🟢 Engine Iniciada', 'color: #00cc00; font-weight: bold;');
      }

      // Initialize modules
      this.config.fingerprint = FingerprintModule.getOrCreate();
      this.config.sessionId = SessionModule.getOrCreate();

      this.pageType = PageDetectorModule.detect();
      this.currentOffer = null;

      // Start
      this.init();
    }

    async init() {
      // Sincronizar visitante
      await VisitorModule.sync(this.config, this.pageType);

      // Carregar campanha inicial
      await this.loadCampaign();

      // Iniciar monitors
      this.startPageMonitor();
      this.startLoginMonitor();
    }

    async loadCampaign(customerId = null) {
      const pageType = this.config.location || PageDetectorModule.detect();

      const offer = await CampaignModule.fetch(this.config, pageType, customerId);

      if (!offer) return;

      // Renderizar widget na posição correta para esta página
      RendererModule.render(this.config, offer, offer.campaign, pageType);

      // Inicializar tracker
      TrackerModule.init(offer.offer_id, this.config);
      TrackerModule.track('view');

      this.currentOffer = offer;
      this.pageType = pageType;
    }

    startPageMonitor() {
      setInterval(() => {
        if (PageDetectorModule.hasChanged()) {
          Logger.log('📍 Página mudou, recarregando campanha');
          this.loadCampaign();
        }
      }, 1000);
    }

    startLoginMonitor() {
      setInterval(() => {
        const customerId = LoginDetectorModule.hasLoggedIn();

        if (customerId) {
          Logger.log('👤 Cliente logado detectado, recarregando campanha', { customerId });
          const pageType = this.pageType || PageDetectorModule.detect();
          RendererModule.clear(pageType, this.config.containerId);
          this.loadCampaign(customerId);
        }
      }, 2000);
    }
  }

  // =========================================================================
  // AUTO-INICIALIZAÇÃO
  // =========================================================================

  function init() {
    const script = d.querySelector('script[data-api-key]');

    if (!script) {
      console.warn('[UpsellSDK] Script tag com data-api-key não encontrado');
      return;
    }

    const config = {
      baseUrl: script.getAttribute('data-base-url'),
      apiKey: script.getAttribute('data-api-key'),
      debug: script.getAttribute('data-debug'),
      containerId: script.getAttribute('data-container-id'),
      location: script.getAttribute('data-location')
    };

    if (!config.baseUrl || !config.apiKey) {
      console.error('[UpsellSDK] data-base-url e data-api-key são obrigatórios');
      return;
    }

    // Inicializar SDK
    w.upsellSdk = new UpsellSDK(config);
  }

  // Inicializar quando DOM estiver pronto
  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);

