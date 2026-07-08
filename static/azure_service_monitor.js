/**
 * Azure Service Monitor - Connection health monitoring and automatic retry
 * Provides robust error handling, circuit breaker pattern, and service degradation
 */

class AzureServiceMonitor {
    constructor() {
        const ttsEnabled = !(typeof window !== 'undefined' && window.__ttsDisabledForFrontend);
        this.services = {
            stt: {
                name: 'Azure Speech-to-Text',
                endpoint: '/api/stt/transcribe',
                method: 'POST',
                timeout: 15000,
                maxRetries: 3,
                baseDelay: 1000,
                maxDelay: 10000,
                circuitThreshold: 5,
                circuitCooldown: 60000
            },
            ...(ttsEnabled ? {
                tts: {
                    name: 'Azure Text-to-Speech',
                    endpoint: '/api/tts/synthesize',
                    method: 'POST',
                    timeout: 10000,
                    maxRetries: 3,
                    baseDelay: 500,
                    maxDelay: 5000,
                    circuitThreshold: 3,
                    circuitCooldown: 30000
                }
            } : {})
        };
        
        // Circuit breaker state for each service
        this.circuitBreakers = {};
        
        // Service statistics
        this.statistics = {};
        
        // Health check interval
        this.healthCheckInterval = 30000; // 30 seconds
        this.healthCheckTimer = null;
        
        // Event callbacks
        this.callbacks = {
            onServiceDown: null,
            onServiceRecovered: null,
            onRetryAttempt: null,
            onCircuitOpen: null,
            onCircuitClose: null
        };
        
        this.initialize();
    }
    
    initialize() {
        // Initialize circuit breakers for each service
        for (const [serviceId, config] of Object.entries(this.services)) {
            this.circuitBreakers[serviceId] = {
                state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
                failureCount: 0,
                lastFailureTime: 0,
                successCount: 0,
                lastSuccessTime: 0,
                totalRequests: 0,
                totalSuccesses: 0,
                totalFailures: 0
            };
            
            this.statistics[serviceId] = {
                averageResponseTime: 0,
                lastResponseTime: 0,
                uptime: 1.0,
                lastError: null,
                consecutiveFailures: 0,
                lastHealthCheck: null
            };
        }
        
        // Start health monitoring
        this.startHealthMonitoring();
        
        console.log('[AzureServiceMonitor] Initialized for services:', Object.keys(this.services));
    }
    
    /**
     * Start health monitoring for all Azure services
     */
    startHealthMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        this.healthCheckTimer = setInterval(() => {
            this.performHealthChecks();
        }, this.healthCheckInterval);
        
        console.log('[AzureServiceMonitor] Health monitoring started');
    }
    
    /**
     * Stop health monitoring
     */
    stopHealthMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        
        console.log('[AzureServiceMonitor] Health monitoring stopped');
    }
    
    /**
     * Perform health checks on all services
     */
    async performHealthChecks() {
        for (const [serviceId, config] of Object.entries(this.services)) {
            try {
                await this.checkServiceHealth(serviceId);
            } catch (error) {
                console.error(`[AzureServiceMonitor] Health check failed for ${serviceId}:`, error);
            }
        }
    }
    
    /**
     * Check individual service health
     */
    async checkServiceHealth(serviceId) {
        const config = this.services[serviceId];
        const stats = this.statistics[serviceId];
        
        try {
            const startTime = Date.now();
            
            // Send a lightweight health check request
            const response = await fetch(`${config.endpoint}/health`, {
                method: 'GET',
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const responseTime = Date.now() - startTime;
            
            if (response.ok) {
                // Service is healthy
                this.recordSuccess(serviceId, responseTime);
                stats.lastHealthCheck = {
                    status: 'healthy',
                    timestamp: Date.now(),
                    responseTime: responseTime
                };
                
                // Close circuit if it was open or half-open
                const circuit = this.circuitBreakers[serviceId];
                if (circuit.state !== 'CLOSED') {
                    this.closeCircuit(serviceId);
                }
            } else {
                throw new Error(`Health check failed: ${response.status}`);
            }
        } catch (error) {
            // Service is unhealthy
            this.recordFailure(serviceId, error.message);
            stats.lastHealthCheck = {
                status: 'unhealthy',
                timestamp: Date.now(),
                error: error.message
            };
            
            // Open circuit if threshold reached
            const circuit = this.circuitBreakers[serviceId];
            if (circuit.failureCount >= config.circuitThreshold && circuit.state === 'CLOSED') {
                this.openCircuit(serviceId);
            }
        }
    }
    
    /**
     * Make a service request with retry logic and circuit breaker
     */
    async makeRequest(serviceId, data, options = {}) {
        const config = this.services[serviceId];
        const circuit = this.circuitBreakers[serviceId];
        
        // Check circuit breaker
        if (circuit.state === 'OPEN') {
            const now = Date.now();
            if (now - circuit.lastFailureTime < config.circuitCooldown) {
                throw new Error(`Circuit breaker OPEN for ${serviceId}`);
            } else {
                // Try to close circuit (half-open state)
                this.halfOpenCircuit(serviceId);
            }
        }
        
        const startTime = Date.now();
        let attempt = 0;
        let lastError = null;
        
        while (attempt < config.maxRetries) {
            attempt++;
            
            try {
                // Notify retry attempt
                if (this.callbacks.onRetryAttempt) {
                    this.callbacks.onRetryAttempt(serviceId, attempt, config.maxRetries);
                }
                
                const response = await this.executeRequest(serviceId, data, options);
                const responseTime = Date.now() - startTime;
                
                // Success
                this.recordSuccess(serviceId, responseTime);
                
                // Close circuit if it was half-open
                if (circuit.state === 'HALF_OPEN') {
                    this.closeCircuit(serviceId);
                }
                
                return response;
                
            } catch (error) {
                lastError = error;
                console.warn(`[AzureServiceMonitor] Request failed for ${serviceId} (attempt ${attempt}/${config.maxRetries}):`, error.message);
                
                // Record failure
                this.recordFailure(serviceId, error.message);
                
                // Check if we should retry
                if (attempt < config.maxRetries) {
                    // Calculate delay with exponential backoff
                    const delay = Math.min(
                        config.baseDelay * Math.pow(2, attempt - 1),
                        config.maxDelay
                    );
                    
                    console.log(`[AzureServiceMonitor] Retrying ${serviceId} in ${delay}ms...`);
                    await this.sleep(delay);
                }
            }
        }
        
        // All retries failed
        const errorMessage = `Service ${serviceId} failed after ${config.maxRetries} attempts: ${lastError.message}`;
        
        // Open circuit if threshold reached
        if (circuit.failureCount >= config.circuitThreshold) {
            this.openCircuit(serviceId);
        }
        
        throw new Error(errorMessage);
    }
    
    /**
     * Execute a single request to the service
     */
    async executeRequest(serviceId, data, options = {}) {
        const config = this.services[serviceId];
        
        const requestOptions = {
            method: config.method,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            timeout: config.timeout,
            ...options
        };
        
        // Add data for POST requests
        if (config.method.toUpperCase() === 'POST' && data) {
            if (data instanceof FormData) {
                requestOptions.body = data;
                delete requestOptions.headers['Content-Type']; // Let browser set it for FormData
            } else {
                requestOptions.body = JSON.stringify(data);
            }
        }
        
        const response = await fetch(config.endpoint, requestOptions);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
    }
    
    /**
     * Record a successful request
     */
    recordSuccess(serviceId, responseTime) {
        const circuit = this.circuitBreakers[serviceId];
        const stats = this.statistics[serviceId];
        
        // Update circuit breaker
        circuit.successCount++;
        circuit.lastSuccessTime = Date.now();
        circuit.totalRequests++;
        circuit.totalSuccesses++;
        
        // Reset failure count on success
        if (circuit.state === 'HALF_OPEN') {
            circuit.failureCount = 0;
        }
        
        // Update statistics
        stats.averageResponseTime = this.calculateAverageResponseTime(serviceId, responseTime);
        stats.lastResponseTime = responseTime;
        stats.consecutiveFailures = 0;
        stats.lastError = null;
        
        // Calculate uptime
        const total = circuit.totalRequests;
        const successes = circuit.totalSuccesses;
        stats.uptime = total > 0 ? successes / total : 1.0;
        
        // Notify service recovery
        if (circuit.consecutiveFailures > 0 && this.callbacks.onServiceRecovered) {
            this.callbacks.onServiceRecovered(serviceId);
        }
        
        circuit.consecutiveFailures = 0;
    }
    
    /**
     * Record a failed request
     */
    recordFailure(serviceId, errorMessage) {
        const circuit = this.circuitBreakers[serviceId];
        const stats = this.statistics[serviceId];
        
        // Update circuit breaker
        circuit.failureCount++;
        circuit.lastFailureTime = Date.now();
        circuit.totalRequests++;
        circuit.totalFailures++;
        circuit.consecutiveFailures++;
        
        // Update statistics
        stats.lastError = errorMessage;
        
        // Calculate uptime
        const total = circuit.totalRequests;
        const successes = circuit.totalSuccesses;
        stats.uptime = total > 0 ? successes / total : 0.0;
        
        // Notify service down
        if (circuit.consecutiveFailures === 1 && this.callbacks.onServiceDown) {
            this.callbacks.onServiceDown(serviceId);
        }
    }
    
    /**
     * Open circuit breaker for a service
     */
    openCircuit(serviceId) {
        const circuit = this.circuitBreakers[serviceId];
        const config = this.services[serviceId];
        
        circuit.state = 'OPEN';
        console.warn(`[AzureServiceMonitor] Circuit OPEN for ${serviceId} (cooldown: ${config.circuitCooldown}ms)`);
        
        if (this.callbacks.onCircuitOpen) {
            this.callbacks.onCircuitOpen(serviceId);
        }
    }
    
    /**
     * Close circuit breaker for a service
     */
    closeCircuit(serviceId) {
        const circuit = this.circuitBreakers[serviceId];
        
        circuit.state = 'CLOSED';
        circuit.failureCount = 0;
        console.log(`[AzureServiceMonitor] Circuit CLOSED for ${serviceId}`);
        
        if (this.callbacks.onCircuitClose) {
            this.callbacks.onCircuitClose(serviceId);
        }
    }
    
    /**
     * Set circuit breaker to half-open state
     */
    halfOpenCircuit(serviceId) {
        const circuit = this.circuitBreakers[serviceId];
        
        circuit.state = 'HALF_OPEN';
        console.log(`[AzureServiceMonitor] Circuit HALF-OPEN for ${serviceId}`);
    }
    
    /**
     * Calculate average response time
     */
    calculateAverageResponseTime(serviceId, newResponseTime) {
        const stats = this.statistics[serviceId];
        const currentAvg = stats.averageResponseTime || 0;
        const alpha = 0.1; // Smoothing factor
        
        return currentAvg * (1 - alpha) + newResponseTime * alpha;
    }
    
    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Get service status
     */
    getServiceStatus(serviceId) {
        const circuit = this.circuitBreakers[serviceId];
        const stats = this.statistics[serviceId];
        const config = this.services[serviceId];
        
        return {
            serviceId,
            serviceName: config.name,
            circuitState: circuit.state,
            isHealthy: circuit.state === 'CLOSED' && circuit.consecutiveFailures === 0,
            uptime: stats.uptime,
            lastError: stats.lastError,
            consecutiveFailures: circuit.consecutiveFailures,
            averageResponseTime: stats.averageResponseTime,
            lastHealthCheck: stats.lastHealthCheck,
            totalRequests: circuit.totalRequests,
            successRate: circuit.totalRequests > 0 ? circuit.totalSuccesses / circuit.totalRequests : 0
        };
    }
    
    /**
     * Get all services status
     */
    getAllServicesStatus() {
        const status = {};
        for (const serviceId of Object.keys(this.services)) {
            status[serviceId] = this.getServiceStatus(serviceId);
        }
        return status;
    }
    
    /**
     * Set event callbacks
     */
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }
    
    /**
     * Reset circuit breaker for a service
     */
    resetCircuitBreaker(serviceId) {
        if (this.circuitBreakers[serviceId]) {
            this.closeCircuit(serviceId);
            console.log(`[AzureServiceMonitor] Circuit breaker reset for ${serviceId}`);
        }
    }
    
    /**
     * Get service configuration
     */
    getServiceConfig(serviceId) {
        return this.services[serviceId];
    }
    
    /**
     * Update service configuration
     */
    updateServiceConfig(serviceId, updates) {
        if (this.services[serviceId]) {
            this.services[serviceId] = { ...this.services[serviceId], ...updates };
            console.log(`[AzureServiceMonitor] Updated configuration for ${serviceId}:`, updates);
        }
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        this.stopHealthMonitoring();
        console.log('[AzureServiceMonitor] Cleaned up');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AzureServiceMonitor = AzureServiceMonitor;
}
