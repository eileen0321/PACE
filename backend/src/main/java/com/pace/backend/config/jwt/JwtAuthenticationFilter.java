package com.pace.backend.config.jwt;

import com.pace.backend.entity.UserAccount;
import com.pace.backend.repository.UserAccountRepository;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

/**
 * jlpt-master JwtAuthenticationFilter 이식 — Authorization: Bearer 토큰을 파싱하고, 토큰의 tokenVersion
 * claim이 DB의 UserAccount.tokenVersion과 다르면 인증을 세팅하지 않는다(= 401). 새 로그인마다 tokenVersion을
 * 올리면 기존에 발급된 토큰이 전부 즉시 무효화되는 방식(단일기기 로그인 강제 겸 토큰 일괄 폐기 수단).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtProvider jwtProvider;
    private final UserAccountRepository userAccountRepository;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);
            try {
                Claims claims = jwtProvider.parse(token);
                Long userId = jwtProvider.getUserId(claims);
                int tokenVersion = jwtProvider.getTokenVersion(claims);

                Optional<UserAccount> userOpt = userAccountRepository.findById(userId);
                if (userOpt.isPresent() && userOpt.get().getTokenVersion() == tokenVersion) {
                    UserAccount user = userOpt.get();
                    List<GrantedAuthority> authorities = user.isPremiumValid()
                            ? List.of(new SimpleGrantedAuthority("ROLE_USER"), new SimpleGrantedAuthority("ROLE_PREMIUM"))
                            : List.of(new SimpleGrantedAuthority("ROLE_USER"));
                    var authentication = new UsernamePasswordAuthenticationToken(userId, null, authorities);
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                } else {
                    log.debug("JWT tokenVersion 불일치 또는 유저 없음 — userId={}", userId);
                }
            } catch (JwtException | IllegalArgumentException e) {
                log.debug("JWT 파싱 실패: {}", e.getMessage());
            }
        }
        chain.doFilter(request, response);
    }
}
