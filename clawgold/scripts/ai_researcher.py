"""
AI Researcher Module
====================
Interfaces with AI CLI tools (opencode, kilocode, gemini) to perform
parallel research and aggregate results.

Usage:
    researcher = AIResearcher()
    results = researcher.research_all("XAUUSD gold price forecast today")
"""

import subprocess
import json
import logging
import re
from typing import List, Dict, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
import time
from scripts.news_db import NewsDatabase

try:
    from agent_executor import AgentExecutor, AgentTool
    AGENT_AVAILABLE = True
except ImportError:
    AGENT_AVAILABLE = False

logger = logging.getLogger(__name__)


@dataclass
class AIResult:
    """Result from an AI tool."""
    tool: str
    query: str
    response: str
    success: bool
    execution_time: float
    error: Optional[str] = None
    confidence: Optional[float] = None
    sources: Optional[List[str]] = None


class AIResearcher:
    """
    Manages AI CLI tools for research with fallback and metrics support.
    
    Supported tools:
        - opencode: OpenCode CLI
        - kilocode: KiloCode CLI  
        - gemini: Google Gemini CLI
    """
    
    def __init__(self, cache_db: Optional[NewsDatabase] = None, cache_ttl_hours: int = 6,
                 enable_fallback: bool = True, max_retries: int = 2, config: Optional[dict] = None):
        self.cache = cache_db
        self.cache_ttl = cache_ttl_hours
        self.enable_fallback = enable_fallback
        self.max_retries = max_retries
        self.config = config
        
        # New AgentExecutor for high-level management
        self.agent_executor = None
        if AGENT_AVAILABLE:
            try:
                self.agent_executor = AgentExecutor(config)
                logger.info("AIResearcher initialized with AgentExecutor")
            except Exception as e:
                logger.warning(f"Could not initialize AgentExecutor: {e}")

        # Dispatch by attribute lookup at call time rather than binding the
        # methods here. Capturing bound methods in __init__ froze them before
        # any test could patch the class, so @patch.object(AIResearcher,
        # '_call_opencode') silently had no effect — which is why
        # test_research_single_success and test_fallback_mechanism failed.
        self.tools = {
            name: self._dispatcher(f'_call_{name}')
            for name in ('opencode', 'kilocode', 'gemini', 'codex')
        }
        # Metrics tracking
        self.metrics = {
            'calls': {'opencode': 0, 'kilocode': 0, 'gemini': 0, 'codex': 0},
            'successes': {'opencode': 0, 'kilocode': 0, 'gemini': 0, 'codex': 0},
            'failures': {'opencode': 0, 'kilocode': 0, 'gemini': 0, 'codex': 0},
            'avg_response_time': {'opencode': 0, 'kilocode': 0, 'gemini': 0, 'codex': 0}
        }
    
    def _dispatcher(self, method_name: str):
        """
        Return a callable that resolves `method_name` on self when invoked.

        The late lookup is the point: it goes through the class every call,
        so patching the method (in tests, or by a subclass) takes effect.
        """
        def call(query: str) -> str:
            return getattr(self, method_name)(query)

        call.__name__ = method_name
        return call

    def get_metrics(self) -> Dict:
        """Get performance metrics for all AI tools."""
        metrics = {}
        for tool in self.tools.keys():
            calls = self.metrics['calls'][tool]
            successes = self.metrics['successes'][tool]
            failures = self.metrics['failures'][tool]
            avg_time = self.metrics['avg_response_time'][tool]
            
            success_rate = (successes / calls * 100) if calls > 0 else 0
            
            metrics[tool] = {
                'total_calls': calls,
                'successes': successes,
                'failures': failures,
                'success_rate': f"{success_rate:.1f}%",
                'avg_response_time': f"{avg_time:.2f}s"
            }
        return metrics
    
    def _update_metrics(self, tool: str, success: bool, response_time: float):
        """Update metrics after a call."""
        self.metrics['calls'][tool] += 1
        if success:
            self.metrics['successes'][tool] += 1
        else:
            self.metrics['failures'][tool] += 1
        
        # Update average response time
        current_avg = self.metrics['avg_response_time'][tool]
        n = self.metrics['calls'][tool]
        self.metrics['avg_response_time'][tool] = ((current_avg * (n - 1)) + response_time) / n
    
    def _call_opencode(self, query: str) -> str:
        """Call OpenCode CLI via AgentExecutor."""
        if self.agent_executor:
            result = self.agent_executor.run(AgentTool.OPENCODE.value, query)
            return result.response if result.success else f"Error: {result.error}"
        
        # Legacy fallback if AgentExecutor is not ready
        try:
            # Build prompt for trading analysis
            prompt = f"Research this trading topic and provide structured analysis:\nQuery: {query}"
            result = subprocess.run(['opencode', 'run', prompt], capture_output=True, text=True, timeout=120)
            return result.stdout.strip() if result.returncode == 0 else f"Error: {result.stderr}"
        except Exception as e:
            return f"Error: {str(e)}"

    def _call_kilocode(self, query: str) -> str:
        """Call KiloCode CLI via AgentExecutor."""
        if self.agent_executor:
            result = self.agent_executor.run(AgentTool.KILOCODE.value, query)
            return result.response if result.success else f"Error: {result.error}"
        
        # Legacy fallback
        try:
            result = subprocess.run(['kilo', 'run', query], capture_output=True, text=True, timeout=120)
            return result.stdout.strip() if result.returncode == 0 else f"Error: {result.stderr}"
        except Exception as e:
            return f"Error: {str(e)}"

    def _call_gemini(self, query: str) -> str:
        """Call Gemini CLI via AgentExecutor."""
        if self.agent_executor:
            result = self.agent_executor.run(AgentTool.GEMINI.value, query)
            return result.response if result.success else f"Error: {result.error}"
        
        # Legacy fallback
        try:
            result = subprocess.run(['gemini', query], capture_output=True, text=True, timeout=120)
            return result.stdout.strip() if result.returncode == 0 else f"Error: {result.stderr}"
        except Exception as e:
            return f"Error: {str(e)}"

    def _call_codex(self, query: str) -> str:
        """Call Codex CLI via AgentExecutor."""
        if self.agent_executor:
            result = self.agent_executor.run(AgentTool.CODEX.value, query)
            return result.response if result.success else f"Error: {result.error}"
        return "Error: AgentExecutor not available for Codex"

    def _extract_confidence(self, text: str) -> Optional[float]:
        """Extract confidence score from AI response."""
        if not text:
            return None
            
        text_lower = text.lower()
        # Common patterns for confidence scores.
        # The percentage-before-the-noun forms ("80% confidence", "80%
        # confidence level") were missing, so a very ordinary phrasing
        # returned None. That propagates: average_confidence becomes 0, and
        # signal confidence is avg_confidence x consensus_strength, so the
        # whole AI signal silently collapsed to zero.
        patterns = [
            r'confidence[:\s]+(\d+\.?\d*)\s*%',
            r'confidence[:\s]+(\d+\.?\d*)',
            r'(\d+\.?\d*)\s*%\s+confidence',
            r'(\d+\.?\d*)\s*%\s+confident',
            r'(\d+\.?\d*)\s*%\s+(?:sure|certain)',
            r'confidence\s+(?:is|of|at)\s+(\d+\.?\d*)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text_lower)
            if match:
                try:
                    score = float(match.group(1))
                    # If it's a percentage (e.g., 75 or 85)
                    if 1 < score <= 100:
                        return score / 100
                    # If it's a normalized float (e.g., 0.85)
                    elif 0 <= score <= 1:
                        return score
                    # Cap high values
                    elif score > 100:
                        return 1.0
                except ValueError:
                    continue
        
        return None
    
    def _extract_sentiment(self, text: str) -> str:
        """Extract sentiment from AI response."""
        text_lower = text.lower()
        
        bullish_indicators = ['bullish', 'positive', 'uptrend', 'buy', 'growth', 'increase']
        bearish_indicators = ['bearish', 'negative', 'downtrend', 'sell', 'decline', 'decrease']
        
        bullish_count = sum(1 for word in bullish_indicators if word in text_lower)
        bearish_count = sum(1 for word in bearish_indicators if word in text_lower)
        
        if bullish_count > bearish_count:
            return 'bullish'
        elif bearish_count > bullish_count:
            return 'bearish'
        else:
            return 'neutral'
    
    def research_single(self, tool: str, query: str,
                        use_cache: bool = True) -> AIResult:
        """
        Research using single AI tool.
        
        Args:
            tool: AI tool name (opencode, kilocode, gemini)
            query: Research query
            use_cache: Whether to use cache
        
        Returns:
            AIResult object
        """
        start_time = time.time()
        
        # Check cache
        if use_cache and self.cache:
            cached = self.cache.get_cached_research(query, tool, self.cache_ttl)
            if cached:
                logger.info(f"Cache hit for {tool}: {query[:50]}...")
                return AIResult(
                    tool=tool,
                    query=query,
                    response=cached['response'],
                    success=True,
                    execution_time=0,
                    confidence=cached.get('confidence'),
                    sources=cached.get('sources')
                )
        
        # Call AI tool with retry logic
        if tool not in self.tools:
            return AIResult(
                tool=tool,
                query=query,
                response="",
                success=False,
                execution_time=0,
                error=f"Unknown tool: {tool}"
            )
        
        logger.info(f"Calling {tool} for: {query[:50]}...")
        
        # Retry logic with fallback
        response = None
        success = False
        last_error = None
        execution_tool = tool
        
        # MUST use tool variable here, so mocks in tests work
        tool_func = self.tools[tool]
        
        for attempt in range(self.max_retries):
            try:
                # Use the function mapped to the tool name
                response = tool_func(query)
                success = response and not response.strip().startswith('Error:')
                if success:
                    break
                else:
                    last_error = response
                    logger.warning(f"{tool} attempt {attempt + 1} failed: {response}")
                    if attempt < self.max_retries - 1:
                        time.sleep(1)  # Wait before retry
            except Exception as e:
                last_error = str(e)
                logger.error(f"{tool} attempt {attempt + 1} exception: {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(1)
        
        # If failed and fallback enabled, try other tools
        if not success and self.enable_fallback:
            logger.info(f"Trying fallback for {tool}...")
            for fallback_name in list(self.tools.keys()):
                if fallback_name != tool:
                    try:
                        fallback_func = self.tools[fallback_name]
                        fb_response = fallback_func(query)
                        fb_success = fb_response and not fb_response.strip().startswith('Error:')
                        if fb_success:
                            response = f"[Fallback from {tool}] {fb_response}"
                            success = True
                            execution_tool = fallback_name
                            logger.info(f"Fallback to {fallback_name} successful")
                            break
                    except Exception as e:
                        logger.error(f"Fallback to {fallback_name} failed: {e}")
        
        execution_time = time.time() - start_time
        
        # Update metrics
        self._update_metrics(execution_tool, success, execution_time)
        
        result = AIResult(
            tool=execution_tool,
            query=query,
            response=response or last_error or "Unknown error",
            success=success,
            execution_time=execution_time,
            error=None if success else (last_error or response),
            confidence=self._extract_confidence(response) if success else None
        )
        
        # Cache successful results
        if success and self.cache:
            self.cache.add_ai_research(
                query=query,
                tool=execution_tool,
                response=response,
                confidence=result.confidence,
                ttl_hours=self.cache_ttl
            )
        
        return result
    
    def research_all(self, query: str, tools: Optional[List[str]] = None,
                     use_cache: bool = True,
                     parallel: bool = True) -> List[AIResult]:
        """
        Research using all AI tools in parallel.
        
        Args:
            query: Research query
            tools: List of tools to use (default: all)
            use_cache: Whether to use cache
            parallel: Run in parallel
        
        Returns:
            List of AIResult objects
        """
        tools_to_use = tools or list(self.tools.keys())
        
        if parallel:
            results = []
            with ThreadPoolExecutor(max_workers=len(tools_to_use)) as executor:
                futures = {
                    executor.submit(self.research_single, tool, query, use_cache): tool
                    for tool in tools_to_use
                }
                
                for future in as_completed(futures):
                    tool = futures[future]
                    try:
                        result = future.result()
                        results.append(result)
                    except Exception as e:
                        logger.error(f"Error from {tool}: {e}")
                        results.append(AIResult(
                            tool=tool,
                            query=query,
                            response="",
                            success=False,
                            execution_time=0,
                            error=str(e)
                        ))
        else:
            results = [
                self.research_single(tool, query, use_cache)
                for tool in tools_to_use
            ]
        
        return results
    
    def aggregate_results(self, results: List[AIResult]) -> Dict:
        """
        Aggregate results from multiple AI tools.
        
        Returns:
            Aggregated analysis
        """
        successful = [r for r in results if r.success]
        failed = [r for r in results if not r.success]
        
        if not successful:
            return {
                'success': False,
                'error': 'All AI tools failed',
                'failures': [{'tool': r.tool, 'error': r.error} for r in failed]
            }
        
        # Count sentiments
        sentiments = {}
        for r in successful:
            sentiment = self._extract_sentiment(r.response)
            sentiments[sentiment] = sentiments.get(sentiment, 0) + 1
        
        # Determine consensus sentiment
        consensus = max(sentiments, key=sentiments.get) if sentiments else 'neutral'
        consensus_strength = sentiments.get(consensus, 0) / len(successful)
        
        # Average confidence
        confidences = [r.confidence for r in successful if r.confidence is not None]
        avg_confidence = sum(confidences) / len(confidences) if confidences else None
        
        # Combine all responses
        combined_text = "\n\n".join([
            f"=== {r.tool.upper()} ===\n{r.response}"
            for r in successful
        ])
        
        return {
            'success': True,
            'query': successful[0].query if successful else '',
            'consensus_sentiment': consensus,
            'consensus_strength': consensus_strength,
            'average_confidence': avg_confidence,
            'tools_used': [r.tool for r in successful],
            'tools_failed': [r.tool for r in failed],
            'sentiment_distribution': sentiments,
            'individual_results': [
                {
                    'tool': r.tool,
                    'sentiment': self._extract_sentiment(r.response),
                    'confidence': r.confidence,
                    'execution_time': r.execution_time
                }
                for r in successful
            ],
            'combined_analysis': combined_text
        }
    
    def quick_sentiment(self, symbol: str, topic: Optional[str] = None) -> Dict:
        """
        Quick sentiment check for a symbol.
        
        Args:
            symbol: Trading symbol (e.g., XAUUSD)
            topic: Specific topic (e.g., "Fed interest rate decision")
        
        Returns:
            Sentiment analysis
        """
        if topic:
            query = f"{symbol} {topic} - current market sentiment and outlook"
        else:
            query = f"{symbol} gold price today - market sentiment and analysis"

        results = self.research_all(query)
        return self.aggregate_results(results)

    def get_market_sentiment(self, symbol: str, topic: Optional[str] = None) -> Dict:
        """
        Market sentiment in the shape the trading pipeline consumes.

        `quick_sentiment` returns the raw aggregate — consensus_sentiment,
        consensus_strength, average_confidence, combined_analysis. The
        pipeline wants `overall`, `score` and `summary`, and used to call
        this method before it existed, so every research step fell back to
        neutral. This adapts one to the other and keeps the raw keys.

        Returns:
            The aggregate dict plus:
              overall: 'bullish' | 'bearish' | 'neutral'
              score:   -1.0..1.0, signed consensus strength
              summary: the combined analysis text
        """
        aggregate = self.quick_sentiment(symbol, topic)

        consensus = aggregate.get('consensus_sentiment', 'neutral')
        strength = float(aggregate.get('consensus_strength', 0.0) or 0.0)
        confidence = float(aggregate.get('average_confidence', 0.0) or 0.0)

        # Signed score: agreement scaled by how confident the tools were.
        magnitude = strength * confidence if confidence else strength
        if consensus == 'bullish':
            score = magnitude
        elif consensus == 'bearish':
            score = -magnitude
        else:
            score = 0.0

        aggregate.update({
            'overall': consensus,
            'score': round(max(-1.0, min(1.0, score)), 4),
            'summary': aggregate.get('combined_analysis', ''),
        })
        return aggregate
