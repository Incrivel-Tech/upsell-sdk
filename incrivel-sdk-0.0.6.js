/**
 * ============================================================================
 * INCRIVELTECH UPSELL SDK v6.0.0
 * ============================================================================
 *
 * Descrição: SDK JavaScript profissional e reativo para integração de campanhas
 * de upsell, Otimizado para SPAs (React, Next.js, Vue).
 * Edição Exclusiva IncrivelTech.
 *
 * Características:
 * - Ouve rotas de SPA nativamente
 * - Rastreamento de visitantes via fingerprint + session_id
 * - Carregamento automático de campanhas baseadas na localização com X-Tenant-Key
 * - Renderização segura e direcionada por classes/IDs configuráveis (Positions Config)
 * - Rastreamento nativo de botões de aceite, recusa e fechamento via seletores
 *   (.upse-accept, #upse-accept, .upse-reject, #upse-reject, .upse-close, #upse-close)
 * - Envio imediato de Tracking (1 por 1) para API do backend sem fila em memória
 *
 * Uso:
 * <script
 *   src="https://cdn.vendamais.top/sdks/incriveltech-sdk-0-0-6.js"
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

    // Evitar múltiplas inicializações
    if (w.VendaMaisUpsellSDK) return;

    // =========================================================================
    // CONFIGURAÇÕES DE POSICIONAMENTO E RENDERIZAÇÃO
    // Edite esta constante para definir onde o Widget deve "agarrar" na tela.
    // =========================================================================
    const CONTAINER_POSITIONS = {
        'product_page': '.sorteio-preco',
        'cart_page': '.carrinho-upsell-area',
        'pre_checkout': '#upsell-checkout-banner',
        'post_purchase': '#sucesso-obrigado-upsell',
        'other': 'body'
    };


    // =========================================================================
    // UTILIDADES CORE
    // =========================================================================

    const generateUUID = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    };

    const Logger = {
        debug: false,
        log: function(msg, data) {
            if (!this.debug) return;
            console.log(`%c[UpsellSDK] ${msg}`, 'color: #00fa9a; font-weight: bold; background: #222; padding: 2px 6px;', data || '');
        },
        error: function(msg, err) {
            if (!this.debug) return;
            console.error(`%c[UpsellSDK] ${msg}`, 'color: #ff4c4c; font-weight: bold; background: #222; padding: 2px 6px;', err || '');
        },
        warn: function(msg, data) {
            if (!this.debug) return;
            console.warn(`%c[UpsellSDK] ${msg}`, 'color: #ff9900; font-weight: bold; background: #222; padding: 2px 6px;', data || '');
        }
    };

    const StorageManager = {
        setLocal: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e) { return false; } },
        getLocal: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch(e) { return null; } },
        setSession: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); return true; } catch(e) { return false; } },
        getSession: (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch(e) { return null; } }
    };

    const HttpClient = {
        async req(url, method, data, apiKey) {
            try {
                const headers = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Tenant-Key': apiKey
                };
                const options = { method, headers };
                if (data && method !== 'GET') options.body = JSON.stringify(data);

                const res = await fetch(url, options);
                let json = null;
                try { json = await res.json(); } catch(e) {}

                if (!res.ok) {
                    Logger.warn(`HTTP ${res.status}`, url);
                    return null;
                }
                return json || true;
            } catch (err) {
                Logger.error(`Network Error HTTP [${method}]`, err);
                return null;
            }
        }
    };

    // =========================================================================
    // MÓDULOS DE CONTEXTO
    // =========================================================================

    const FingerprintModule = {
        KEY: 'vm_sdk_visitor_fp',
        getOrCreate() {
            let fp = StorageManager.getLocal(this.KEY);
            if (!fp) {
                fp = generateUUID();
                StorageManager.setLocal(this.KEY, fp);
            }
            return fp;
        }
    };

    const SessionModule = {
        KEY: 'vm_session_id',
        getOrCreate() {
            let sessionId = StorageManager.getSession(this.KEY);
            if (!sessionId) {
                sessionId = generateUUID();
                StorageManager.setSession(this.KEY, sessionId);
            }
            return sessionId;
        }
    };

    const PageDetectorModule = {
        detect() {
            const path = w.location.pathname.toLowerCase();
            const text = d.body ? d.body.innerText.toLowerCase() : '';

            if (path === '/' || path === '') return 'home';
            if (path.includes('/campanha') || path.includes('/produto') || path.includes('/product')) return 'product_page';
            if (path.includes('/cart') || path.includes('/carrinho')) return 'cart_page';
            if (path.includes('/checkout') || path.includes('/compra') || path.includes('/order')) {
                 if (text.includes('aprovado') || text.includes('sucesso') || text.includes('obrigado')) {
                     return 'post_purchase';
                 }
                 return 'pre_checkout';
            }
            if (path.includes('/sucesso') || path.includes('/obrigado')) return 'post_purchase';

            return 'other';
        }
    };


    // =========================================================================
    // SDK ENGINE CORE PRO
    // =========================================================================

    class VendaMaisSDK {
        constructor(config) {
            this.config = {
                baseUrl: config.baseUrl.replace(/\/$/, ''),
                apiKey: config.apiKey,
                debug: config.debug === 'true' || config.debug === true
            };

            Logger.debug = this.config.debug;
            Logger.log('🚀 Iniciando IncrivelTech Upsell SDK v6.0.0');

            this.state = {
                fingerprint: FingerprintModule.getOrCreate(),
                sessionId: SessionModule.getOrCreate(),
                lastPath: '',
                currentPageType: null,
                currentOfferId: null
            };

            this.init();
        }

        async init() {
            this.setupRouterHooks();
            await this.handleRouteChange();
        }

        setupRouterHooks() {
            w.addEventListener('popstate', () => this.handleRouteChange());

            const pushState = history.pushState;
            history.pushState = (...args) => {
                pushState.apply(history, args);
                this.handleRouteChange();
            };

            const replaceState = history.replaceState;
            history.replaceState = (...args) => {
                replaceState.apply(history, args);
                this.handleRouteChange();
            };

            this.setupMutationObserver();
        }

        setupMutationObserver() {
            let debounceTimer;
            const observer = new MutationObserver(() => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    const currentPath = w.location.pathname;
                    if (this.state.lastPath !== currentPath) {
                        this.handleRouteChange();
                    }
                }, 200);
            });
            observer.observe(d.body, { childList: true, subtree: true });
        }

        async handleRouteChange() {
            const currentPath = w.location.pathname;

            await new Promise(r => setTimeout(r, 100));

            const pageType = PageDetectorModule.detect();

            if (this.state.lastPath !== currentPath || this.state.currentPageType !== pageType) {
                Logger.log(`🧭 Rota alterada: ${currentPath} -> Categoria: ${pageType}`);

                this.state.lastPath = currentPath;
                this.state.currentPageType = pageType;

                this.cleanupWidget();

                await this.syncVisitor();

                if (pageType !== 'other' && pageType !== 'home') {
                    await this.fetchAndRenderOffer(pageType);
                }
            }
        }

        async syncVisitor() {
            const url = `${this.config.baseUrl}/v1/widget/visitor/sync`;
            await HttpClient.req(url, 'POST', {
                fingerprint: this.state.fingerprint,
                session_id: this.state.sessionId,
                current_page: this.state.lastPath
            }, this.config.apiKey);
        }

        async fetchAndRenderOffer(pageType) {
            Logger.log(`🛒 Buscando oferta para: ${pageType}`);
            const url = `${this.config.baseUrl}/v1/widget/offer?location=${pageType}&fingerprint=${this.state.fingerprint}`;

            const data = await HttpClient.req(url, 'GET', null, this.config.apiKey);

            if (data && (data.offer_id || data.campaign_id)) {
                this.state.currentOfferId = data.offer_id;

                if(data.offer_id) {
                    this.trackEvent('view', data.offer_id);
                }

                const campaign = data.campaign || data;
                if (campaign && campaign.widget_html) {
                    this.renderWidget(campaign.widget_html, campaign.widget_css, pageType);
                }
            } else {
                Logger.log('Nenhuma oferta retornada ativa para esta página.');
            }
        }

        // ==========================================================
        // RENDER & CLEANUP COM POSIÇÃO ESPECÍFICA
        // ==========================================================
        renderWidget(html, css, pageType) {
            const selectorTarget = CONTAINER_POSITIONS[pageType] || CONTAINER_POSITIONS['other'];
            let maxRetries = 10;

            const mount = () => {
                let baseContainer = d.querySelector(selectorTarget);

                if (!baseContainer) {
                    maxRetries--;
                    if(maxRetries > 0) {
                        Logger.log(`Aguardando aparecimento do container HTML: "${selectorTarget}"...`);
                        setTimeout(mount, 250);
                    } else {
                        Logger.warn(`Container "${selectorTarget}" não foi encontrado na DOM atual. Sendo renderizado dentro do "body" como fallback.`);
                        baseContainer = d.body;
                        this.processMount(html, css, baseContainer);
                    }
                    return;
                }

                this.processMount(html, css, baseContainer);
            };

            mount();
        }

        processMount(html, css, baseContainer) {
            this.cleanupWidget();

            if (css) {
                let styleTag = d.getElementById('vm-upsell-styles');
                if (!styleTag) {
                    styleTag = d.createElement('style');
                    styleTag.id = 'vm-upsell-styles';
                    d.head.appendChild(styleTag);
                }
                styleTag.innerHTML = css;
            }

            let wrapper = d.createElement('div');
            wrapper.id = 'vm-upsell-wrapper';
            wrapper.innerHTML = html;

            baseContainer.appendChild(wrapper);
            Logger.log(`✨ Widget renderizado com sucesso no nó:`, baseContainer);

            this.bindWidgetEvents(wrapper);
        }

        cleanupWidget() {
            const wrapper = d.getElementById('vm-upsell-wrapper');
            if (wrapper) {
                Logger.log('🧹 Limpando widget da página anterior');
                wrapper.remove();
            }
            this.state.currentOfferId = null;
        }

        bindWidgetEvents(wrapper) {
            // Método auxiliar para lidar com cliques independentemente do seletor
            const handleActionClick = (e, action) => {
                Logger.log(`🔥 Ação detectada no botão: ${action}`);

                if (this.state.currentOfferId) {
                    this.trackEvent(action, this.state.currentOfferId);
                }

                // Se for rejeitar ou fechar, fecha o widget imediatamente previnir duplo tracking e poluição de tela
                if (action === 'reject' || action === 'close') {
                    e.preventDefault();
                    this.cleanupWidget();
                }
            };

            // 1. Rastreio Antigo / Universal via [data-upsell-action="..."]
            const defaultButtons = wrapper.querySelectorAll('[data-upsell-action]');
            defaultButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = btn.getAttribute('data-upsell-action') || 'click';
                    handleActionClick(e, action);
                });
            });

            // 2. Botões de Accept exclusivos IncrivelTech
            const acceptButtons = wrapper.querySelectorAll('.upse-accept, #upse-accept');
            acceptButtons.forEach(btn => {
                btn.addEventListener('click', (e) => handleActionClick(e, 'accept'));
            });

            // 3. Botões de Reject exclusivos IncrivelTech
            const rejectButtons = wrapper.querySelectorAll('.upse-reject, #upse-reject');
            rejectButtons.forEach(btn => {
                btn.addEventListener('click', (e) => handleActionClick(e, 'reject'));
            });

            // 4. Botões de Close exclusivos IncrivelTech
            const closeButtons = wrapper.querySelectorAll('.upse-close, #upse-close');
            closeButtons.forEach(btn => {
                btn.addEventListener('click', (e) => handleActionClick(e, 'close'));
            });
        }

        // ==========================================================
        // TRACKING ENGINE (ENVIO IMEDIATO 1 POR 1)
        // ==========================================================
        async trackEvent(action, offerId) {
            if (!offerId) return;

            const payload = {
                offer_id: offerId,
                action: action,
                visitor_id: this.state.fingerprint,
                session_id: this.state.sessionId,
                timestamp: new Date().toISOString()
            };

            Logger.log(`📤 Enviando tracking imediato -> '${action}'`, { action, offerId });

            // Envia para o endpoint single track imediatamente
            const url = `${this.config.baseUrl}/v1/widget/track`;
            await HttpClient.req(url, 'POST', payload, this.config.apiKey);
        }
    }

    // =========================================================================
    // AUTOBOOT
    // =========================================================================
    function boot() {
        const scriptEl = d.querySelector('script[data-api-key]');
        if (scriptEl) {
            w.VendaMaisUpsellSDK = new VendaMaisSDK({
                baseUrl: scriptEl.getAttribute('data-base-url') || '',
                apiKey: scriptEl.getAttribute('data-api-key') || '',
                debug: scriptEl.getAttribute('data-debug')
            });
        } else {
            console.warn('[UpsellSDK] Script de inicialização sem atributo `data-api-key`. Evitado AutoBoot.');
        }
    }

    if (d.readyState === 'loading') {
        d.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})(window, document);
